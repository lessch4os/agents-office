import * as net from "net";

interface Config {
  serverUrl: string;
  password: string;
  socketPath: string;
  verbose: boolean;
}

function loadConfig(): Config | null {
  // Env vars first
  const serverUrl = process.env.AGENTS_OFFICE_SERVER ?? "";
  const password = process.env.AGENTS_OFFICE_PASSWORD ?? "";
    if (serverUrl && password) {
    return { serverUrl, password, socketPath: resolveSocketPath(), verbose: !!process.env.AGENTS_OFFICE_VERBOSE };
  }
  // Config file ~/.agents-office/config.json
  const home = process.env.HOME ?? "/tmp";
  try {
    const cfg = JSON.parse(require("fs").readFileSync(`${home}/.agents-office/config.json`, "utf-8")) as Record<string, string>;
    return {
      serverUrl: cfg.server_url ?? serverUrl,
      password: cfg.password ?? password,
      socketPath: resolveSocketPath(),
      verbose: !!process.env.AGENTS_OFFICE_VERBOSE,
    };
  } catch {}
  // CLI args
  const args = process.argv.slice(2);
  let verbose = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server") return { serverUrl: args[++i] ?? "", password: args[++i] ?? "", socketPath: resolveSocketPath(), verbose: verbose || !!process.env.AGENTS_OFFICE_VERBOSE };
    if (args[i] === "--password") { const p = args[++i] ?? ""; return { serverUrl: args[++i] ?? "", password: p, socketPath: resolveSocketPath(), verbose: verbose || !!process.env.AGENTS_OFFICE_VERBOSE }; }
    if (args[i] === "--verbose" || args[i] === "-v") verbose = true;
  }
  return null;
}

function resolveSocketPath(): string {
  if (process.env.AGENTS_OFFICE_SOCKET) return process.env.AGENTS_OFFICE_SOCKET;
  if (process.env.XDG_RUNTIME_DIR) return `${process.env.XDG_RUNTIME_DIR}/agents-office.sock`;
  return `/tmp/agents-office-${process.getuid?.() ?? 0}.sock`;
}

const cfg = loadConfig();
if (!cfg) {
  console.error("usage: AGENTS_OFFICE_SERVER=wss://host/hook AGENTS_OFFICE_PASSWORD=secret agents-office-forwarder");
  console.error("  or:  agents-office-forwarder --server wss://host/hook --password secret");
  process.exit(1);
}

const SOCKET_PATH = cfg.socketPath;
const SERVER_URL = cfg.serverUrl;
const PASSWORD = cfg.password;
const VERBOSE = cfg.verbose;

const log = VERBOSE ? (...args: unknown[]) => console.error("[forwarder]", ...args) : () => {};

// ── WebSocket connection to server ────────────────────────────────

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let sendBuf: string[] = [];

function connectWs(): void {
  if (ws) { ws.close(); ws = null; }
  try {
    ws = new WebSocket(SERVER_URL, [], { headers: { Authorization: `Bearer ${PASSWORD}` } } as any);
  } catch {
    ws = new WebSocket(SERVER_URL);
  }

  ws.onopen = () => {
    console.error(`forwarder: connected to ${SERVER_URL}`);
    // Flush buffer
    for (const msg of sendBuf.splice(0)) {
      ws!.send(msg);
      log("flushed", msg.slice(0, 80));
    }
  };

  ws.onclose = (ev) => {
    log("ws closed", ev.code, ev.reason);
    ws = null;
    reconnectTimer = setTimeout(connectWs, 3000);
  };

  ws.onerror = (ev) => { log("ws error", ev); ws?.close(); };

  ws.onmessage = (ev) => {
    // Server can send ping, forwarder replies pong
    try {
      const d = JSON.parse(ev.data as string);
      if (d.type === "ping") ws?.send(JSON.stringify({ type: "pong" }));
    } catch {}
  };
}

function send(payload: object): void {
  const msg = JSON.stringify(payload);
  log("send", msg.slice(0, 120));
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(msg);
  } else {
    sendBuf.push(msg);
    if (sendBuf.length > 1000) sendBuf.shift();
  }
}

// ── Unix socket listener ──────────────────────────────────────────

try { require("fs").unlinkSync(SOCKET_PATH); } catch {}

const server = net.createServer((socket) => {
  log("unix client connected");
  let buf = "";
  socket.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const payload = JSON.parse(trimmed);
        log("received", (payload as Record<string, unknown>).hook_event_name ?? "event");
        send(payload);
      } catch (err) {
        log("malformed line", (err as Error).message);
      }
    }
  });
  socket.on("error", (err) => log("unix error", err));
  socket.on("close", () => log("unix client disconnected"));
});

server.listen(SOCKET_PATH, () => {
  console.error(`forwarder: listening on ${SOCKET_PATH}`);
});

// ── Connect ───────────────────────────────────────────────────────

connectWs();

// Keep alive — Bun exits when no async ops
setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" })); }, 30000);
process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
