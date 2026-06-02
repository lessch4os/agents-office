import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { SceneState } from "./state";
import { Reducer } from "./reducer";
import { sceneToWire } from "./wire";
import { HookSocketListener } from "./hook-socket";
import { JsonlWatcher } from "./jsonl-watcher";
import { decodeCcLine, ccSessionEnded, ccDeriveLabel } from "./claude-code";
import { decodeAgLine, agSessionEnded, deriveAgLabel } from "./antigravity";
import { OpenCodeSseWatcher } from "./opencode-sse";
import { createLogger, createFileAppender } from "./logger";
import { SessionStore } from "./session-store";
import { PricingManager } from "./pricing";
import { EmitManager } from "./emitter";
import { decodeHookPayload } from "./decoder";
import { loadFileConfig, defaultSocketPath, defaultConfigPath } from "./config";

const VERSION = "0.1.26";
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────────────────

interface Config {
  port: number;
  socketPath: string;
  projectsRoot: string;
  agBrainRoot: string;
  opencodeSseUrl: string | null;
  maxDesks: number;
  webRoot: string;
  verbose: boolean;
  dbPath: string;
  password: string | null;
  username: string;
  relayTo: string | null;
}

function defaultSocketPath2(): string {
  if (process.env.AGENTS_OFFICE_SOCKET) return process.env.AGENTS_OFFICE_SOCKET;
  if (process.env.XDG_RUNTIME_DIR) return `${process.env.XDG_RUNTIME_DIR}/agents-office.sock`;
  const uid = process.getuid?.() ?? 0;
  return `/tmp/agents-office-${uid}.sock`;
}

function resolveWebRoot(webRoot: string): string {
  if (webRoot) {
    try { if (Bun.file(`${webRoot}/index.html`).size > 0) return webRoot; } catch {}
  }
  // Relative to binary: ../share/agents-office/web-dist
  const binaryDir = dirname(process.execPath);
  const sharePath = resolve(binaryDir, "../share/agents-office/web-dist");
  try { if (Bun.file(`${sharePath}/index.html`).size > 0) return sharePath; } catch {}
  // Standard share path (brew / manual install convention)
  const staticSharePath = "/usr/local/share/agents-office/web-dist";
  try { if (Bun.file(`${staticSharePath}/index.html`).size > 0) return staticSharePath; } catch {}
  // npm package path
  let npmRoot = "";
  try {
    npmRoot = Bun.spawnSync(["npm", "root", "-g"]).stdout.toString().trim();
  } catch {}
  if (npmRoot) {
    const npmPath = resolve(npmRoot, "@lessch4os/agents-office/web/dist");
    try { if (Bun.file(`${npmPath}/index.html`).size > 0) return npmPath; } catch {}
  }
  // Source repo (dev mode)
  const repoPath = resolve(__dirname, "../../web/dist");
  try { if (Bun.file(`${repoPath}/index.html`).size > 0) return repoPath; } catch {}
  return webRoot;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const home = process.env.HOME ?? "/tmp";
  const fileCfg = loadFileConfig();
  const cfg: Config = {
    port: fileCfg.port ?? 8080,
    socketPath: fileCfg.socketPath ?? defaultSocketPath2(),
    projectsRoot: fileCfg.projectsRoot ?? (process.env.HOME ? `${process.env.HOME}/.claude/projects` : "/tmp"),
    agBrainRoot: fileCfg.agBrainRoot ?? (process.env.HOME ? `${process.env.HOME}/.gemini/antigravity-cli/brain` : "/tmp"),
    opencodeSseUrl: fileCfg.opencodeSseUrl ?? null,
    maxDesks: fileCfg.maxDesks ?? 16,
    webRoot: resolveWebRoot(fileCfg.webRoot ?? ""),
    verbose: fileCfg.verbose ?? false,
    dbPath: process.env.AGENTS_OFFICE_DB ?? fileCfg.db ?? `${home}/.agents-office/sessions.db`,
    password: process.env.AGENTS_OFFICE_PASSWORD ?? fileCfg.password ?? null,
    username: fileCfg.username ?? "agents-office",
    relayTo: process.env.AGENTS_OFFICE_RELAY_TO ?? fileCfg.relayTo ?? null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--port": cfg.port = parseInt(args[++i] ?? "8080", 10); break;
      case "--socket": cfg.socketPath = args[++i] ?? cfg.socketPath; break;
      case "--projects-root": cfg.projectsRoot = args[++i] ?? cfg.projectsRoot; break;
      case "--ag-brain-root": cfg.agBrainRoot = args[++i] ?? cfg.agBrainRoot; break;
      case "--opencode-sse-url": cfg.opencodeSseUrl = args[++i] ?? null; break;
      case "--max-desks": cfg.maxDesks = parseInt(args[++i] ?? "16", 10); break;
      case "--web-root": cfg.webRoot = args[++i] ?? cfg.webRoot; break;
      case "--verbose": case "-v": cfg.verbose = true; break;
      case "--db": cfg.dbPath = args[++i] ?? cfg.dbPath; break;
      case "--password": cfg.password = args[++i] ?? null; break;
      case "--username": cfg.username = args[++i] ?? cfg.username; break;
      case "--relay-to": cfg.relayTo = args[++i] ?? null; break;
    }
  }
  return cfg;
}

// ── Helpers ────────────────────────────────────────────────────────

function defaultDaemonLogPath(): string {
  if (process.env.AGENTS_OFFICE_DAEMON_LOG) return process.env.AGENTS_OFFICE_DAEMON_LOG;
  const home = process.env.HOME ?? "/tmp";
  return `${home}/.agents-office/logs/daemon.log`;
}

// ── Auth ──────────────────────────────────────────────────────────

const _sessions = new Map<string, { username: string; createdAt: number }>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function createSession(username: string): string {
  const id = crypto.randomUUID();
  _sessions.set(id, { username, createdAt: Date.now() });
  return id;
}

function validateSession(id: string | null): boolean {
  if (!id) return false;
  const s = _sessions.get(id);
  if (!s) return false;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    _sessions.delete(id);
    return false;
  }
  return true;
}

function parseCookie(header: string | null): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}

function LOGIN_PAGE(error = false): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agents-office</title>
<style>body{margin:0;background:#121318;color:#e3e1e9;font-family:'JetBrains Mono',monospace;display:flex;align-items:center;justify-content:center;height:100vh}
form{background:#1e1f25;padding:32px;border:1px solid #3b4b3a;border-radius:2px}
h1{font-size:18px;margin:0 0 24px;color:#00e55b;font-weight:600}
label{display:block;font-size:11px;margin:16px 0 4px;color:#b9ccb5;text-transform:uppercase;letter-spacing:.1em}
input{background:#121318;border:1px solid #3b4b3a;color:#e3e1e9;padding:8px 12px;width:240px;font-family:'JetBrains Mono',monospace;font-size:14px;outline:none;display:block}
input:focus{border-color:#00e55b}
button{background:#00e55b;color:#002107;border:none;padding:10px 24px;margin-top:24px;font-family:'JetBrains Mono',monospace;font-weight:600;cursor:pointer;border-radius:2px}
button:hover{background:#6bff83}
.error{color:#ffb4ab;font-size:12px;margin-top:12px}
</style></head><body>
<form method="post">
<h1>agents-office</h1>
<label>username</label>
<input name="username" value="agents-office">
<label>password</label>
<input name="password" type="password">
<button type="submit">sign in</button>
${error ? '<div class="error">invalid credentials</div>' : ""}
</form></body></html>`; }

// ── Main ──────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`agents-office v${VERSION}`);
  console.log("");
  console.log("Usage: agents-office [setup] [forwarder] [options]");
  console.log("");
  console.log("Subcommands:");
  console.log("  forwarder             Forward local hooks to remote server");
  console.log("  setup                 Interactive configuration wizard");
  console.log("  doctor                Run diagnostics and exit");
  console.log("  reload                Gracefully restart CC/OC + daemon");
  console.log("  install               Install CC hooks + OC plugin then exit");
  console.log("");
  console.log("Options:");
  console.log("  --port <n>            HTTP/WebSocket port (default: 8080)");
  console.log("  --password <s>        Auth password (enables login + hook auth)");
  console.log("  --username <s>        Login username (default: agents-office)");
  console.log("  --relay-to <url>      Forward events to remote server");
  console.log("  --web-root <path>     Path to web frontend build output");
  console.log("  --socket <path>       Unix socket path for hook shim");
  console.log("  --projects-root <path> Claude Code projects directory");
  console.log("  --ag-brain-root <path> Antigravity brain directory");
  console.log("  --opencode-sse-url    OpenCode SSE event stream URL");
  console.log("  --max-desks <n>       Number of agent desks (default: 16)");
  console.log("  --db <path>           SQLite database path");
  console.log("  --verbose, -v         Verbose logging");
  console.log("  --version             Print version and exit");
  console.log("  --help                Print this help and exit");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-V")) {
    console.log(VERSION);
    process.exit(0);
  }
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }
  if (args.includes("--doctor") || args[0] === "doctor") {
    const { runDoctor } = await import("./doctor");
    await runDoctor(args.slice(1));
    return;
  }
  if (args.includes("--reload") || args[0] === "reload") {
    const { runReload } = await import("./reloader");
    await runReload(args.slice(1));
    return;
  }
  if (args.includes("--install") || args.includes("install")) {
    await runInstall();
    return;
  }
  if (args[0] === "forwarder") {
    const { runForwarder, printForwarderHelp } = await import("./forwarder");
    runForwarder(args.slice(1));
    return;
  }
  if (args[0] === "setup") {
    const { runSetup } = await import("./setup");
    await runSetup();
    return;
  }
  const cfg = parseArgs();
  return runLocal(cfg);
}

async function runInstall(): Promise<void> {
  const home = process.env.HOME ?? "/tmp";
  const agentDir = `${home}/.agents-office`;
  Bun.spawnSync(["mkdir", "-p", agentDir]);
  Bun.spawnSync(["mkdir", "-p", `${home}/.config/opencode/plugins`]);

  const selfPath = process.argv[1] ?? "";
  const isCompiled = !selfPath.includes("main.ts");
  const repoDir = isCompiled ? "" : selfPath.replace("/daemon/src/main.ts", "");
  const scriptsDir = isCompiled ? "" : `${repoDir}/scripts`;

  // ── Find binaries ──────────────────────────────────────────────
  async function findInPath(name: string): Promise<string | null> {
    const r = Bun.spawnSync(["which", name]);
    if (r.exitCode === 0) return r.stdout.toString().trim();
    for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", `${home}/.nix-profile/bin`]) {
      try { const f = Bun.file(`${dir}/${name}`); if ((await f.stat()).isFile) return `${dir}/${name}`; } catch {}
    }
    return null;
  }

  const hookBin = isCompiled ? await findInPath("agents-office-hook") : `${repoDir}/daemon/agents-office-hook`;

  function hooksExist(path: string): boolean {
    try { return Bun.file(path).exists(); } catch { return false; }
  }

  const pluginSrc = isCompiled
    ? await findInPath("opencode-plugin.js")
      ?? (await (async () => {
        // Common Homebrew plugin path
        const brewPlugin = "/opt/homebrew/opt/agents-office/share/agents-office/opencode-plugin.js";
        try { const f = Bun.file(brewPlugin); if ((await f.stat()).isFile) return brewPlugin; } catch {}
        return null;
      })())
      ?? `${home}/.config/opencode/plugins/agents-office.js`
    : `${repoDir}/daemon/dist/opencode-plugin.js`;

  if (!hookBin && isCompiled) {
    console.error("agents-office-hook not found in PATH or common Homebrew directories.");
    console.error("Reinstall with: brew reinstall agents-office");
    return;
  }

  // ── Claude Code hooks ───────────────────────────────────────────
  async function installCcHooks(): Promise<void> {
    const ccSettingsPath = `${home}/.claude/settings.json`;
    let config: Record<string, unknown> = {};
    try {
      const existing = await Bun.file(ccSettingsPath).text();
      config = JSON.parse(existing);
    } catch {
      // File doesn't exist or invalid — start fresh
      config = {};
    }

    // Remove any old _agents_office entries first
    const hooks = (config["hooks"] as Record<string, unknown[]> | undefined) ?? {};
    for (const key of Object.keys(hooks)) {
      const entries = hooks[key] as unknown[];
      hooks[key] = entries.filter((e: any) => !e?._agents_office);
    }

    // Add fresh entries
    const entry = { _agents_office: true, hooks: [{ command: hookBin, type: "command" }], matcher: ".*" };
    for (const event of ["SessionStart", "SessionEnd", "PreToolUse", "PostToolUse", "Notification"]) {
      const existing = (hooks[event] as unknown[]) ?? [];
      existing.push(entry);
      hooks[event] = existing;
    }
    config["hooks"] = hooks;

    await Bun.write(ccSettingsPath, JSON.stringify(config, null, 2));
    console.log("✓ Claude Code hooks installed in ~/.claude/settings.json");
  }

  // ── OpenCode plugin ─────────────────────────────────────────────
  async function installOcPlugin(): Promise<void> {
    const target = `${home}/.config/opencode/plugins/agents-office.js`;
    // Remove stale symlink if exists
    try { await Bun.spawnSync(["rm", "-f", target]); } catch {}
    const src = pluginSrc;
    if (await Bun.file(src).exists()) {
      await Bun.spawnSync(["ln", "-sf", src, target]);
      console.log("✓ OpenCode plugin installed");
    } else {
      console.warn(`OpenCode plugin not found at: ${src}`);
      console.warn("  The hook binary is installed but the plugin file is missing.");
      console.warn("  Reinstall with: brew reinstall agents-office");
    }
  }

  // ── Execute ────────────────────────────────────────────────────
  if (!isCompiled && repoDir && hookBin && hooksExist(hookBin)) {
    // Source install with local hooks — use scripts
    console.log(`installing hook: ${hookBin}`);
    const r = Bun.spawnSync(["bash", `${scriptsDir}/install-hooks.sh`], { cwd: repoDir });
    if (r.exitCode !== 0) console.warn("hook install failed (non-fatal)");
    console.log(`installing OC plugin: ${pluginSrc}`);
    const r2 = Bun.spawnSync(["bash", `${scriptsDir}/install-opencode-plugin.sh`], { cwd: repoDir });
    if (r2.exitCode !== 0) console.warn("OC plugin install failed (non-fatal)");
  } else {
    // Compiled binary or source-without-local-build — use direct approach
    await installCcHooks();
    await installOcPlugin();
  }

  console.log("");
  console.log("  data dir: ~/.agents-office/");
  console.log("Restart Claude Code / OpenCode to activate.");
}

// ── Local mode ─────────────────────────────────────────────────────

async function runLocal(cfg: Config) {
  const log = createLogger(cfg.verbose);
  log.info(`agents-office daemon v${VERSION} starting (port=${cfg.port})`);

  // Validate web root
  const indexPath = `${cfg.webRoot}/index.html`;
  try {
    const f = Bun.file(indexPath);
    if (f.size === 0) throw new Error("empty");
  } catch {
    log.warn(`web root not found: ${cfg.webRoot}/index.html`);
    log.warn("  web UI will not be served. Build it with: bun run build:web");
    log.warn("  or set --web-root to the correct path.");
  }

  const fileLog = createFileAppender(defaultDaemonLogPath());

  const scene = new SceneState(cfg.maxDesks);
  const reducer = new Reducer();
  const store = new SessionStore(cfg.dbPath);
  const clients = new Set<WebSocket>();
  const em = new EmitManager(scene, reducer, store, clients, fileLog, log);

  // Restore active sessions from SQLite (survives daemon restart)
  const restored = store.restoreActiveSessions(Date.now());
  for (const event of restored) {
    em.emit("restore", event);
  }
  if (restored.length > 0) log.info(`restored ${restored.filter(e => e.type === "sessionStart").length} active sessions`);

  // Start hook socket
  try {
    const hook = await HookSocketListener.bind(cfg.socketPath, log);
    hook.run((transport, event) => em.emit(transport, event), (sessionId, ts, source, hookEvent, payload) => {
      store.storeRawEvent(sessionId, ts, source, hookEvent, payload);
    });
    log.info(`hook socket: ${cfg.socketPath}`);
  } catch (e) {
    log.warn("hook socket bind failed:", e);
  }

  // Start CC JSONL watcher
  const ccWatcher = JsonlWatcher.new(
    cfg.projectsRoot,
    "claude-code",
    decodeCcLine,
    ccDeriveLabel,
    ccSessionEnded,
    log,
  );
  ccWatcher.run((transport, event) => em.emit(transport, event)).catch((e) => log.warn("CC watcher exited:", e));
  log.info(`CC watcher: ${cfg.projectsRoot}`);

  // Start Antigravity JSONL watcher
  try {
    const agWatcher = JsonlWatcher.new(
      cfg.agBrainRoot,
      "antigravity",
      decodeAgLine,
      (_fp, cwd) => deriveAgLabel(cwd),
      agSessionEnded,
      log,
    );
    agWatcher.run((transport, event) => em.emit(transport, event)).catch((e) => log.warn("AG watcher exited:", e));
    log.info(`AG watcher: ${cfg.agBrainRoot}`);
  } catch {
    log.warn("Antigravity brain dir not found, skipping");
  }

  // Start OpenCode SSE watcher
  if (cfg.opencodeSseUrl) {
    const ocSse = new OpenCodeSseWatcher(
      cfg.opencodeSseUrl,
      "opencode",
      (transport, event) => em.emit(transport, event),
      log,
    );
    ocSse.run().catch((e) => log.warn("OpenCode SSE watcher exited:", e));
    log.info(`OpenCode SSE watcher: ${cfg.opencodeSseUrl}`);
  }

  // Tick interval
  setInterval(() => em.tick(Date.now()), 1000);

  // HTTP + WebSocket server
  const hookClients = new Set<WebSocket>();
  const server = Bun.serve({
    port: cfg.port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // Health check — always open
      if (url.pathname === "/health") return new Response("ok");

      // Login page
      if (url.pathname === "/login") {
        if (req.method === "POST" && cfg.password) {
          const form = await req.formData().catch(() => new FormData());
          if (form.get("password") === cfg.password && form.get("username") === cfg.username) {
            const sid = createSession(cfg.username);
            return new Response(null, {
              status: 302,
              headers: {
                "Set-Cookie": `agents_office_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
                Location: "/",
              },
            });
          }
          return new Response(LOGIN_PAGE(true), { headers: { "Content-Type": "text/html" } });
        }
        return new Response(LOGIN_PAGE(false), { headers: { "Content-Type": "text/html" } });
      }

      // Auth check (when password is set)
      if (cfg.password) {
        // WS /hook — password via Authorization header or query param
        if (url.pathname === "/hook" && req.headers.get("Upgrade") === "websocket") {
          let ok = false;
          const auth = req.headers.get("Authorization") ?? "";
          if (auth === `Bearer ${cfg.password}`) ok = true;
          if (url.searchParams.get("password") === cfg.password) ok = true;
          if (!ok) return new Response("unauthorized", { status: 401 });
          const upgraded = server.upgrade(req, { data: { type: "hook" } });
          if (upgraded) return new Response();
          return new Response("upgrade failed", { status: 400 });
        }

        const cookies = parseCookie(req.headers.get("Cookie"));
        if (!validateSession(cookies.agents_office_session)) {
          if (req.headers.get("Upgrade") === "websocket") return new Response("unauthorized", { status: 401 });
          if (url.pathname.startsWith("/api/")) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
          return new Response(null, { status: 302, headers: { Location: "/login" } });
        }
      }

      // WebSocket upgrade — browser feed
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req, { data: { type: "ui" } });
        if (upgraded) return new Response();
        return new Response("upgrade failed", { status: 400 });
      }

      // Sessions history API
      if (url.pathname.startsWith("/api/sessions")) {
        return handleSessionsApi(url, req, store);
      }

      // Pricing API
      if (url.pathname.startsWith("/api/pricing")) {
        return handlePricingApi(url, req, store.getPricingManager());
      }

      // Static files
      return serveStatic(url, cfg.webRoot);
    },
    websocket: {
      open(ws) {
        const data = (ws as any).data ?? {};
        if (data.type === "hook") {
          hookClients.add(ws as unknown as WebSocket);
          log.info("hook client connected");
          return;
        }
        clients.add(ws as unknown as WebSocket);
        const wire = sceneToWire(scene, Date.now());
        ws.send(JSON.stringify({ type: "scene", data: wire }));
      },
      close(ws) {
        const data = (ws as any).data ?? {};
        if (data.type === "hook") {
          hookClients.delete(ws as unknown as WebSocket);
          return;
        }
        clients.delete(ws as unknown as WebSocket);
      },
      message(ws, msg) {
        if (typeof msg !== "string") return;
        try {
          const data = JSON.parse(msg);
          // From remote forwarder — raw hook event
          if (data.hook_event_name) {
            const events = decodeHookPayload(data);
            for (const event of events) {
              em.emit("remote-hook", event);
            }
            return;
          }
          // Ping/pong from UI clients
          if (data.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
        } catch {}
      },
    },
  });

  if (cfg.password) log.info(`auth enabled (username=${cfg.username})`);
  console.log(`listening on http://localhost:${cfg.port}`);

  // ── Relay mode: forward all events to remote server ────────────
  if (cfg.relayTo) {
    let relayWs: WebSocket | null = null;
    let relayBuf: string[] = [];
    function connectRelay(): void {
      try { relayWs?.close(); } catch {}
      relayWs = new WebSocket(cfg.relayTo!, [], { headers: { Authorization: `Bearer ${cfg.password ?? ""}` } } as any);
      relayWs.onopen = () => {
        log.info(`relay connected to ${cfg.relayTo}`);
        for (const m of relayBuf.splice(0)) relayWs?.send(m);
      };
      relayWs.onclose = () => { relayWs = null; setTimeout(connectRelay, 3000); };
      relayWs.onerror = () => { relayWs?.close(); };
    }
    connectRelay();
    // Wrap emit to also relay
    const origEmit = em.emit.bind(em);
    em.emit = (transport, event) => {
      origEmit(transport, event);
      const msg = JSON.stringify(event);
      if (relayWs?.readyState === WebSocket.OPEN) {
        relayWs.send(msg);
      } else {
        relayBuf.push(msg);
        if (relayBuf.length > 5000) relayBuf.shift();
      }
    };
  }
}

// ── Sessions API ───────────────────────────────────────────────────

async function handleSessionsApi(url: URL, req: Request, store: SessionStore): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const p = url.pathname;

  // GET /api/sessions/compare?a=<id>&b=<id>
  if (req.method === "GET" && p === "/api/sessions/compare") {
    const a = url.searchParams.get("a");
    const b = url.searchParams.get("b");
    if (!a || !b) return json({ error: "a and b required" }, 400);
    const result = store.compareSessions(a, b);
    if (!result) return json({ error: "session not found" }, 404);
    return json(result);
  }

  // GET /api/sessions
  if (req.method === "GET" && p === "/api/sessions") {
    const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10));
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const tag = url.searchParams.get("tag") ?? undefined;
    const source = url.searchParams.get("source") ?? undefined;
    return json(store.listSessions({ limit, offset, tag, source }));
  }

  // POST /api/sessions/:id/tag  body: { tag: string }
  if (req.method === "POST" && p.endsWith("/tag")) {
    const id = p.slice("/api/sessions/".length, -"/tag".length);
    let body: { tag?: unknown };
    try { body = await req.json() as { tag?: unknown }; } catch { return json({ error: "invalid json" }, 400); }
    if (typeof body.tag !== "string") return json({ error: "tag must be string" }, 400);
    store.tagSession(id, body.tag);
    return json({ ok: true });
  }

  // DELETE /api/sessions/:id/tag/:name
  if (req.method === "DELETE" && p.includes("/tag/")) {
    const parts = p.split("/");
    const tagName = parts[parts.length - 1] ?? "";
    const id = parts[3] ?? "";
    if (!id || !tagName) return json({ error: "bad path" }, 400);
    store.untagSession(id, tagName);
    return json({ ok: true });
  }

  // GET /api/sessions/:id
  if (req.method === "GET" && p.startsWith("/api/sessions/")) {
    const id = p.slice("/api/sessions/".length);
    if (!id) return json({ error: "id required" }, 400);
    const session = store.getSession(id);
    if (!session) return json({ error: "not found" }, 404);
    return json(session);
  }

  return json({ error: "not found" }, 404);
}

// ── Pricing API ─────────────────────────────────────────────────────

async function handlePricingApi(url: URL, req: Request, pricing: PricingManager): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  // GET /api/pricing
  if (req.method === "GET") {
    return json(pricing.list());
  }

  // PUT /api/pricing  body: { model_name, input_per_m, output_per_m, cache_read_per_m }
  if (req.method === "PUT") {
    let body: { model_name?: unknown; input_per_m?: unknown; output_per_m?: unknown; cache_read_per_m?: unknown };
    try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
    if (typeof body.model_name !== "string" || !body.model_name) return json({ error: "model_name required" }, 400);
    const input = Number(body.input_per_m);
    const output = Number(body.output_per_m);
    const cache = Number(body.cache_read_per_m ?? 0);
    if (!Number.isFinite(input) || !Number.isFinite(output) || !Number.isFinite(cache)) {
      return json({ error: "input_per_m, output_per_m, cache_read_per_m must be numbers" }, 400);
    }
    pricing.set(body.model_name, input, output, cache);
    return json({ ok: true });
  }

  // POST /api/pricing/reset
  if (req.method === "POST" && url.pathname.endsWith("/reset")) {
    pricing.resetToDefaults();
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}

// ── Static file server ─────────────────────────────────────────────

function serveStatic(url: URL, webRoot: string): Response {
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const fullPath = `${webRoot}${filePath}`;

  try {
    const file = Bun.file(fullPath);
    if (file.size > 0) return new Response(file);
  } catch {}

  // SPA fallback
  try {
    const index = Bun.file(`${webRoot}/index.html`);
    if (index.size > 0) return new Response(index);
  } catch {}

  return new Response("not found", { status: 404 });
}

// ── Start ──────────────────────────────────────────────────────────

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
