import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const VERSION = "0.1.23";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail" | "skip";
  message: string;
}

const home = process.env.HOME ?? "/tmp";
const uid = process.getuid?.() ?? 0;

function note(msg: string): void {
  console.log(`  ${msg}`);
}

function ok(msg: string): void {
  console.log(`  \u2713 ${msg}`);
}

function warn(msg: string): void {
  console.log(`  \u26A0 ${msg}`);
}

function fail(msg: string): void {
  console.log(`  \u2717 ${msg}`);
}

function which(cmd: string): string | null {
  const r = Bun.spawnSync(["which", cmd]);
  return r.exitCode === 0 ? r.stdout.toString().trim() : null;
}

function pgrep(name: string, exact = true): number | null {
  try {
    const args = exact ? ["pgrep", "-x", name] : ["pgrep", "-f", name];
    const r = Bun.spawnSync(args);
    if (r.exitCode === 0) {
      const pids = r.stdout.toString().trim().split("\n");
      return parseInt(pids[0]!, 10);
    }
  } catch {}
  return null;
}

function pgrepAll(name: string, exact = true): number[] {
  try {
    const args = exact ? ["pgrep", "-x", name] : ["pgrep", "-f", name];
    const r = Bun.spawnSync(args);
    if (r.exitCode === 0) {
      return r.stdout.toString().trim().split("\n").filter(Boolean).map(Number);
    }
  } catch {}
  return [];
}

function pidof(name: string): number | null {
  try {
    const r = Bun.spawnSync(["pidof", name]);
    if (r.exitCode === 0) {
      const parts = r.stdout.toString().trim().split(/\s+/);
      return parseInt(parts[0]!, 10);
    }
  } catch {}
  return null;
}

function findPid(name: string): number | null {
  return pgrep(name) ?? pidof(name) ?? null;
}

function findDaemonPidInSystemd(): boolean {
  try {
    const r = Bun.spawnSync(["systemctl", "is-active", "agents-office"]);
    return r.stdout.toString().trim() === "active";
  } catch {}
  return false;
}

function findDaemonPid(): { pid: number | null; method: string } {
  // Exact process name match
  let pid = findPid("agents-office");
  if (pid) return { pid, method: "process" };
  // Broader match: bun x @lessch4os/agents-office, npx, etc.
  // Exclude forwarder and hook subprocesses
  const allPids = pgrepAll("agents-office", false);
  for (const p of allPids) {
    try {
      const cmdline = Bun.spawnSync(["ps", "-p", String(p), "-o", "comm="]);
      const comm = cmdline.stdout.toString().trim();
      if (comm.includes("agents-office-forwarder") || comm.includes("agents-office-hook")) continue;
      return { pid: p, method: "cmdline" };
    } catch {}
  }
  // systemd service
  if (findDaemonPidInSystemd()) return { pid: 0, method: "systemd" };
  return { pid: null, method: "none" };
}

function findForwarderPid(): { pid: number | null; method: string } {
  let pid = findPid("agents-office-forwarder");
  if (pid) return { pid, method: "process" };
  pid = pgrep("agents-office-forwarder", false);
  if (pid) return { pid, method: "cmdline" };
  return { pid: null, method: "none" };
}

function resolveDaemonSocket(): string {
  if (process.env.AGENTS_OFFICE_SOCKET) return process.env.AGENTS_OFFICE_SOCKET;
  if (process.env.XDG_RUNTIME_DIR) return `${process.env.XDG_RUNTIME_DIR}/agents-office.sock`;
  return `/tmp/agents-office-${uid}.sock`;
}

function resolveForwarderSocket(): string {
  if (process.env.AGENTS_OFFICE_SOCKET) return process.env.AGENTS_OFFICE_SOCKET;
  if (process.env.XDG_RUNTIME_DIR) return `${process.env.XDG_RUNTIME_DIR}/agents-office-forwarder.sock`;
  return `/tmp/agents-office-forwarder-${uid}.sock`;
}

function findActualSockets(): string[] {
  // Scan common socket locations to find any existing agents-office sockets
  const candidates = new Set<string>();
  candidates.add(resolveDaemonSocket());
  candidates.add(resolveForwarderSocket());
  candidates.add(`/tmp/agents-office-${uid}.sock`);
  candidates.add(`/tmp/agents-office-forwarder-${uid}.sock`);
  if (process.env.XDG_RUNTIME_DIR) {
    candidates.add(`${process.env.XDG_RUNTIME_DIR}/agents-office.sock`);
    candidates.add(`${process.env.XDG_RUNTIME_DIR}/agents-office-forwarder.sock`);
  }
  return [...candidates].filter((p) => fs.existsSync(p));
}

function platform(): string {
  return os.platform();
}

function isMacOS(): boolean {
  return platform() === "darwin";
}

function currentBarch(): string {
  const arch = os.arch();
  if (arch === "x64") return "x64";
  if (arch === "arm64") return "arm64";
  return arch;
}

function currentPlatformTag(): string {
  const osTag = platform() === "darwin" ? "darwin" : "linux";
  return `${osTag}-${currentBarch()}`;
}

function platformBinaryPath(name: string): string {
  // Try brew opt path first (macOS)
  const brewPath = `/opt/homebrew/opt/${name}/bin/${name}`;
  if (fs.existsSync(brewPath)) return brewPath;
  // Try: daemon/agents-office-{os}-{arch} (platform-specific compile)
  const tagged = `${name}-${currentPlatformTag()}`;
  const daemonDir = path.join(path.dirname(process.argv[1] ?? ""), "..", "daemon");
  if (fs.existsSync(path.join(daemonDir, tagged))) return path.join(daemonDir, tagged);
  const daemonDirFallback = path.join(home, ".agents-office", "bin");
  if (fs.existsSync(path.join(daemonDirFallback, tagged))) return path.join(daemonDirFallback, tagged);
  return tagged; // fallback: just return the name for PATH lookup
}

function lsof(pathFilter?: string): string[] {
  const args = ["-F", "pcn"];
  if (pathFilter) args.push(pathFilter);
  try {
    const r = Bun.spawnSync(["lsof", ...args]);
    if (r.exitCode === 0) return r.stdout.toString().trim().split("\n").filter(Boolean);
  } catch {}
  // Try with sudo (may prompt, but on servers with passwordless sudo it works)
  try {
    const r = Bun.spawnSync(["sudo", "-n", "lsof", ...args]);
    if (r.exitCode === 0) return r.stdout.toString().trim().split("\n").filter(Boolean);
  } catch {}
  return [];
}

function readlinkSocket(socketPath: string): string | null {
  // Linux: check /proc/*/fd/* for the socket inode
  try {
    const r = Bun.spawnSync(["stat", "--format=%i", socketPath]);
    if (r.exitCode !== 0) return null;
    const inode = r.stdout.toString().trim();
    if (!inode) return null;
    const procR = Bun.spawnSync(["grep", "-l", `socket:${inode}`, "/proc/*/fd/*"]);
    if (procR.exitCode === 0) {
      const match = procR.stdout.toString().trim().split("\n")[0] ?? "";
      const parts = match.split("/");
      return parts[2] ?? null;
    }
  } catch {}
  return null;
}

function parseLsof(output: string[]): Array<{ pid: string; command: string; name: string }> {
  const result: Array<{ pid: string; command: string; name: string }> = [];
  let current: Record<string, string> = {};
  for (const line of output) {
    if (line.startsWith("p")) current.pid = line.slice(1);
    else if (line.startsWith("c")) current.command = line.slice(1);
    else if (line.startsWith("n")) {
      current.name = line.slice(1);
      if (current.pid && current.command) {
        result.push({ pid: current.pid, command: current.command, name: current.name });
      }
      current = {};
    }
  }
  return result;
}

// ── Checks ──────────────────────────────────────────────────────────

async function checkBinaryVersions(): Promise<CheckResult> {
  const platformBinary = platformBinaryPath("agents-office");
  const binaries = [
    { name: "agents-office", cmd: which("agents-office") },
    { name: `agents-office-${currentPlatformTag()}`, cmd: which(`agents-office-${currentPlatformTag()}`) ?? (fs.existsSync(platformBinary) ? platformBinary : null) },
    { name: "agents-office-forwarder", cmd: which("agents-office-forwarder") },
    { name: "agents-office-hook", cmd: which("agents-office-hook") },
  ];

  const found: string[] = [];
  const notFound: string[] = [];
  const versions = new Set<string>();

  for (const { name, cmd } of binaries) {
    if (cmd) {
      found.push(name);
      try {
        const r = Bun.spawnSync([cmd, "--version"]);
        if (r.exitCode === 0) {
          const v = r.stdout.toString().trim();
          if (v.length > 0) versions.add(v);
        }
      } catch {
        versions.add("?");
      }
    } else {
      if (!name.includes(`${currentPlatformTag()}`)) notFound.push(name);
    }
  }

  const lines: string[] = [];
  if (versions.size === 1) {
    const v = [...versions][0]!;
    lines.push(`all v${v}`);
  } else if (versions.size > 1) {
    lines.push(`version mismatch: ${[...versions].join(", ")}`);
  }
  if (notFound.length > 0) {
    lines.push(`not in PATH: ${notFound.join(", ")}`);
  }

  if (found.length === 0) {
    return { name: "binary-versions", status: "fail", message: "no agents-office binaries found" };
  }
  if (versions.size > 1) {
    return { name: "binary-versions", status: "warn", message: lines.join("; ") };
  }
  return { name: "binary-versions", status: "ok", message: lines.join("; ") };
}

async function checkDaemonRunning(): Promise<CheckResult> {
  const { pid, method } = findDaemonPid();
  if (pid !== null && method === "systemd") {
    return { name: "daemon-running", status: "ok", message: "running (systemd service)" };
  }
  if (pid) {
    const via = method === "cmdline" ? " (via cmdline match)" : "";
    return { name: "daemon-running", status: "ok", message: `running (PID ${pid})${via}` };
  }
  // Fallback: if port is in use and socket exists, daemon is likely running
  const socketExists = fs.existsSync(resolveDaemonSocket());
  const portInUse = !(() => {
    try { const l = Bun.listen({ port: 8080, hostname: "127.0.0.1", socket: {} }); l.stop(); return false; } catch { return true; }
  })();
  if (portInUse && socketExists) {
    return { name: "daemon-running", status: "ok", message: "likely running (port 8080 + socket found)" };
  }
  return { name: "daemon-running", status: "warn", message: "not running — daemon must be started to receive hooks" };
}

async function checkForwarderRunning(): Promise<CheckResult> {
  const { pid, method } = findForwarderPid();
  if (pid) {
    const via = method === "cmdline" ? " (via cmdline match)" : "";
    return { name: "forwarder-running", status: "ok", message: `running (PID ${pid})${via}` };
  }
  return { name: "forwarder-running", status: "warn", message: "not running — used only for remote forwarding" };
}

async function checkSocketOwner(): Promise<CheckResult> {
  const actualSockets = findActualSockets();
  if (actualSockets.length === 0) {
    return { name: "socket-owner", status: "ok", message: "no sockets found" };
  }

  const owners: string[] = [];

  for (const sockPath of actualSockets) {
    // Try lsof to find the process that has this socket open
    const entry = lsof(sockPath);
    if (entry.length > 0) {
      const parsed = parseLsof(entry);
      const procs = parsed.map((p) => `${p.command} (PID ${p.pid})`).join(", ");
      owners.push(`${path.basename(sockPath)}: ${procs}`);
    } else {
      // Fallback: try /proc/*/fd/* on Linux
      const pid = readlinkSocket(sockPath);
      if (pid) {
        owners.push(`${path.basename(sockPath)}: owned by PID ${pid}`);
      } else {
        owners.push(`${path.basename(sockPath)}: exists (unable to determine owner)`);
      }
    }
  }

  return { name: "socket-owner", status: "ok", message: owners.join("; ") };
}

async function checkSocketConflict(): Promise<CheckResult> {
  const daemonRunning = findDaemonPid().pid;
  const forwarderRunning = findForwarderPid().pid;

  if (!daemonRunning && !forwarderRunning) {
    return { name: "socket-conflict", status: "skip", message: "neither daemon nor forwarder running" };
  }

  // Only check the daemon socket path — forwarder owning its own socket is expected
  const daemonSocket = resolveDaemonSocket();
  if (!fs.existsSync(daemonSocket)) {
    return { name: "socket-conflict", status: "ok", message: "daemon socket not found — no conflict" };
  }

  const entry = lsof(daemonSocket);
  if (entry.length === 0) {
    return { name: "socket-conflict", status: "ok", message: "no conflict detected" };
  }

  const parsed = parseLsof(entry);
  const procs = parsed.map((p) => p.command);
  const hasDaemon = procs.some((c) => c === "agents-office" || c === "bun");
  const hasForwarder = procs.some((c) => c === "agents-office-forwarder");

  if (hasDaemon && hasForwarder) {
    return { name: "socket-conflict", status: "fail", message: `both daemon and forwarder use ${daemonSocket} — events may be lost` };
  }

  if (hasForwarder && !hasDaemon) {
    return { name: "socket-conflict", status: "warn", message: `forwarder owns daemon socket ${daemonSocket}` };
  }

  return { name: "socket-conflict", status: "ok", message: "no conflict detected" };
}

async function checkCcHooks(): Promise<CheckResult> {
  const settingsPath = `${home}/.claude/settings.json`;
  if (!fs.existsSync(settingsPath)) {
    return { name: "cc-hooks", status: "fail", message: `~/.claude/settings.json not found` };
  }
  try {
    const content = Bun.file(settingsPath);
    const text = await content.text();
    const config = JSON.parse(text);
    const hooks = config.hooks;
    if (!hooks || typeof hooks !== "object") {
      return { name: "cc-hooks", status: "fail", message: "no hooks section in ~/.claude/settings.json" };
    }

    let agentOfficeCount = 0;
    for (const eventName of Object.keys(hooks)) {
      const entries = hooks[eventName];
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (entry?._agents_office) agentOfficeCount++;
        }
      }
    }

    if (agentOfficeCount === 0) {
      return { name: "cc-hooks", status: "fail", message: "no agents-office hooks found in ~/.claude/settings.json" };
    }
    return { name: "cc-hooks", status: "ok", message: `${agentOfficeCount} hook entries in ~/.claude/settings.json` };
  } catch (e) {
    return { name: "cc-hooks", status: "fail", message: `failed to parse ~/.claude/settings.json: ${(e as Error).message}` };
  }
}

async function checkOcPlugin(): Promise<CheckResult> {
  const pluginPath = `${home}/.config/opencode/plugins/agents-office.js`;
  if (!fs.existsSync(pluginPath)) {
    return { name: "oc-plugin", status: "fail", message: `plugin not found at ${pluginPath}` };
  }
  try {
    const stat = fs.statSync(pluginPath);
    if (stat.size === 0) {
      return { name: "oc-plugin", status: "warn", message: "plugin file exists but is empty" };
    }
    return { name: "oc-plugin", status: "ok", message: `found (${formatSize(stat.size)})` };
  } catch {
    return { name: "oc-plugin", status: "fail", message: `cannot stat ${pluginPath}` };
  }
}

async function checkPort(): Promise<CheckResult> {
  // Read port from config or default
  let port = parseInt(process.env.AGENTS_OFFICE_PORT ?? "8080", 10);
  const configPath = `${home}/.agents-office/config.json`;
  if (fs.existsSync(configPath)) {
    try {
      const text = await Bun.file(configPath).text();
      const cfg = JSON.parse(text);
      if (cfg.port) port = parseInt(cfg.port, 10);
    } catch {}
  }
  try {
    const listener = Bun.listen({ port, hostname: "127.0.0.1", socket: {} });
    listener.stop();
    const { pid } = findDaemonPid();
    if (pid !== null) {
      return { name: "port", status: "warn", message: `port ${port} is free — daemon process found but not serving HTTP` };
    }
    return { name: "port", status: "warn", message: `port ${port} is free — daemon not listening?` };
  } catch {
    return { name: "port", status: "ok", message: `port ${port} in use (expected for running daemon)` };
  }
}

async function checkDatabase(): Promise<CheckResult> {
  const dbPath = process.env.AGENTS_OFFICE_DB ?? `${home}/.agents-office/sessions.db`;
  if (!fs.existsSync(dbPath)) {
    return { name: "database", status: "warn", message: `database not found at ${dbPath}` };
  }
  try {
    const { Database } = await import("bun:sqlite");
    const db = new Database(dbPath);
    const row = db.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
    db.close();
    if (row) {
      const result = Object.values(row)[0] as string;
      if (result === "ok") {
        return { name: "database", status: "ok", message: `healthy (${formatSize(fs.statSync(dbPath).size)})` };
      }
      return { name: "database", status: "warn", message: `integrity issue: ${result}` };
    }
    return { name: "database", status: "ok", message: `accessible (${formatSize(fs.statSync(dbPath).size)})` };
  } catch (e) {
    return { name: "database", status: "fail", message: `error: ${(e as Error).message}` };
  }
}

async function checkLogs(): Promise<CheckResult> {
  const logDir = `${home}/.agents-office/logs`;
  const logFile = process.env.AGENTS_OFFICE_DAEMON_LOG ?? `${logDir}/daemon.log`;
  if (!fs.existsSync(logFile)) {
    return { name: "daemon-logs", status: "skip", message: `no log file at ${logFile}` };
  }
  try {
    const content = await Bun.file(logFile).text();
    const lines = content.trim().split("\n");
    const recent = lines.slice(-200);
    const errors = recent.filter((l) => l.includes("error") || l.includes("Error") || l.includes("ERROR"));
    const warnings = recent.filter((l) => l.includes("warn") || l.includes("WARN"));
    const parts: string[] = [];
    if (errors.length > 0) {
      parts.push(`${errors.length} recent errors`);
    }
    if (warnings.length > 0) {
      parts.push(`${warnings.length} recent warnings`);
    }
    if (parts.length === 0) {
      return { name: "daemon-logs", status: "ok", message: `last 200 lines clean (${lines.length} total)` };
    }
    return { name: "daemon-logs", status: "warn", message: parts.join("; ") };
  } catch (e) {
    return { name: "daemon-logs", status: "fail", message: `cannot read log: ${(e as Error).message}` };
  }
}

async function checkConfig(): Promise<CheckResult> {
  const configPath = `${home}/.agents-office/config.json`;
  if (!fs.existsSync(configPath)) {
    return { name: "config-file", status: "skip", message: "no config file at ~/.agents-office/config.json" };
  }
  try {
    const text = await Bun.file(configPath).text();
    const cfg = JSON.parse(text);
    const fields: string[] = [];
    if (cfg.server_url) fields.push(`server=${cfg.server_url}`);
    if (cfg.password) fields.push("password set");
    if (Object.keys(cfg).length === 0) {
      return { name: "config-file", status: "warn", message: "config file exists but is empty" };
    }
    return { name: "config-file", status: "ok", message: fields.join("; ") || "valid JSON" };
  } catch (e) {
    return { name: "config-file", status: "fail", message: `invalid JSON: ${(e as Error).message}` };
  }
}

async function checkTranscriptDirs(): Promise<CheckResult> {
  const dirs: string[] = [];
  const ccDir = `${home}/.claude/projects`;
  const agDir = `${home}/.gemini/antigravity-cli/brain`;

  if (fs.existsSync(ccDir)) {
    const count = fs.readdirSync(ccDir).filter((f) => f.endsWith(".jsonl")).length;
    dirs.push(`CC: ${ccDir} (${count} transcripts)`);
  } else {
    dirs.push(`CC: ${ccDir} (not found)`);
  }

  if (fs.existsSync(agDir)) {
    const count = fs.readdirSync(agDir).filter((f) => f.endsWith(".jsonl")).length;
    dirs.push(`AG: ${agDir} (${count} transcripts)`);
  } else {
    dirs.push(`AG: ${agDir} (not found)`);
  }

  return { name: "transcript-dirs", status: "ok", message: dirs.join("; ") };
}

async function checkDaemonHealth(): Promise<CheckResult> {
  try {
    const r = await fetch("http://127.0.0.1:8080/health");
    if (r.ok) {
      const text = await r.text();
      return { name: "daemon-health", status: "ok", message: `responded: "${text.trim()}"` };
    }
    return { name: "daemon-health", status: "warn", message: `HTTP ${r.status}` };
  } catch {
    const { pid } = findDaemonPid();
    if (pid !== null) {
      return { name: "daemon-health", status: "warn", message: "daemon process found but HTTP not responding" };
    }
    return { name: "daemon-health", status: "skip", message: "daemon not running — skipping health check" };
  }
}

async function checkUpgradeMethod(): Promise<CheckResult> {
  // Check npm global install
  const npmLs = Bun.spawnSync(["npm", "ls", "-g", "@lessch4os/agents-office", "--json"]);
  if (npmLs.exitCode === 0) {
    try {
      const parsed = JSON.parse(npmLs.stdout.toString());
      const pkg = parsed?.dependencies?.["@lessch4os/agents-office"];
      if (pkg) {
        return { name: "upgrade-method", status: "ok", message: `installed via npm (v${pkg.version ?? "?"}) — run: npm update -g @lessch4os/agents-office` };
      }
    } catch {}
  }

  // Check brew install (macOS)
  if (isMacOS()) {
    const brewLs = Bun.spawnSync(["brew", "list", "agents-office", "--versions"]);
    if (brewLs.exitCode === 0) {
      const version = brewLs.stdout.toString().trim().split(/\s+/)[1] ?? "?";
      return { name: "upgrade-method", status: "ok", message: `installed via Homebrew (v${version}) — run: brew upgrade agents-office` };
    }
  }

  // Check if running from source (current working dir has daemon/src/main.ts)
  try {
    const selfPath = process.argv[1] ?? "";
    if (selfPath.includes("main.ts") || selfPath.includes("doctor.ts")) {
      return { name: "upgrade-method", status: "ok", message: "running from source — run: git pull && bun run build" };
    }
  } catch {}

  // Check if bunx cache exists
  const bunxCheck = which("agents-office");
  if (bunxCheck && bunxCheck.includes("bunx")) {
    return { name: "upgrade-method", status: "ok", message: "run via bunx — always uses latest" };
  }

  // Binary install (brew bottle, or manual binary)
  return { name: "upgrade-method", status: "warn", message: "unknown install method — reinstall from https://agents-office.lessch4os.com" };
}

async function checkRemoteServer(): Promise<CheckResult> {
  // Try to read remote server URL from config file or env
  let serverUrl = process.env.AGENTS_OFFICE_SERVER ?? "";
  if (!serverUrl) {
    const configPath = `${home}/.agents-office/config.json`;
    if (fs.existsSync(configPath)) {
      try {
        const text = await Bun.file(configPath).text();
        const cfg = JSON.parse(text);
        serverUrl = cfg.server_url ?? "";
      } catch {}
    }
  }

  if (!serverUrl) {
    return { name: "remote-server", status: "skip", message: "no remote server configured" };
  }

  // Strip protocol and path to get hostname
  try {
    const url = new URL(serverUrl);
    return { name: "remote-server", status: "ok", message: `configured: ${url.host}${url.pathname}` };
  } catch {
    return { name: "remote-server", status: "warn", message: `invalid URL: ${serverUrl}` };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Doctor ──────────────────────────────────────────────────────────

const allChecks: Array<() => Promise<CheckResult>> = [
  checkBinaryVersions,
  checkDaemonRunning,
  checkForwarderRunning,
  checkDaemonHealth,
  checkUpgradeMethod,
  checkSocketOwner,
  checkSocketConflict,
  checkCcHooks,
  checkOcPlugin,
  checkPort,
  checkDatabase,
  checkLogs,
  checkConfig,
  checkTranscriptDirs,
  checkRemoteServer,
];

export async function runDoctor(args: string[]): Promise<void> {
  console.log(`agents-office doctor v${VERSION}`);
  console.log(`  platform: ${platform()} (${os.hostname()}) arch=${currentBarch()}`);
  console.log(`  home: ${home}`);
  console.log(`  binary: agents-office-${currentPlatformTag()}`);
  console.log(`  daemon socket: ${resolveDaemonSocket()}`);
  console.log(`  forwarder socket: ${resolveForwarderSocket()}`);
  console.log("");

  let pass = 0;
  let warnings = 0;
  let failures = 0;
  let skipped = 0;

  for (const check of allChecks) {
    const result = await check();
    const icon = result.status === "ok" ? "\u2713" : result.status === "warn" ? "\u26A0" : result.status === "fail" ? "\u2717" : "\u2014";
    console.log(`  ${icon} ${result.name}: ${result.message}`);
    if (result.status === "ok") pass++;
    else if (result.status === "warn") warnings++;
    else if (result.status === "fail") failures++;
    else skipped++;
  }

  console.log("");
  const total = pass + warnings + failures + skipped;
  const parts: string[] = [];
  if (pass > 0) parts.push(`${pass} passed`);
  if (warnings > 0) parts.push(`${warnings} warnings`);
  if (failures > 0) parts.push(`${failures} failures`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  console.log(`  ${total} checks — ${parts.join(", ")}`);

  if (failures > 0 || warnings > 0) {
    console.log("");
    console.log("  Common fixes:");
    const { pid: dPid, method: dMethod } = findDaemonPid();
    const { pid: fPid } = findForwarderPid();
    if (!dPid) {
      console.log("    \u2022 Start the daemon: agents-office --port 8080");
      if (findDaemonPidInSystemd()) {
        console.log("    \u2022 Restart systemd service: sudo systemctl restart agents-office");
      }
    }
    if (!fPid && isMacOS()) {
      // Only show forwarder hint on macOS since it's a laptop client
    }
    console.log("    \u2022 Install CC hooks: agents-office --install");
    if (isMacOS()) {
      console.log("    \u2022 Restart brew service: brew services restart agents-office");
    }
    console.log("    \u2022 Restart Claude Code and OpenCode to reload hooks/plugins");
    process.exitCode = 1;
  }
}
