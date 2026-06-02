import * as net from "net";
import * as os from "os";
import * as fs from "fs";

const VERSION = "0.1.25";

interface ForwarderConfig {
  serverUrl: string;
  password: string;
  socketPath: string;
  verbose: boolean;
}

function resolveSocketPath(): string {
  if (process.env.AGENTS_OFFICE_SOCKET) return process.env.AGENTS_OFFICE_SOCKET;
  if (process.env.XDG_RUNTIME_DIR) return `${process.env.XDG_RUNTIME_DIR}/agents-office-forwarder.sock`;
  return `/tmp/agents-office-forwarder-${process.getuid?.() ?? 0}.sock`;
}

function loadForwarderConfig(args: string[]): ForwarderConfig | null {
  let serverUrl = process.env.AGENTS_OFFICE_SERVER ?? "";
  let password = process.env.AGENTS_OFFICE_PASSWORD ?? "";
  let verbose = !!process.env.AGENTS_OFFICE_VERBOSE;
  let socketPath = resolveSocketPath();

  // Config file ~/.agents-office/config.json
  if (!serverUrl || !password) {
    const home = process.env.HOME ?? "/tmp";
    try {
      const cfg = JSON.parse(fs.readFileSync(`${home}/.agents-office/config.json`, "utf-8")) as Record<string, string>;
      if (!serverUrl) serverUrl = cfg.server_url ?? "";
      if (!password) password = cfg.password ?? "";
      if (serverUrl && password) console.error("forwarder: using config from ~/.agents-office/config.json");
    } catch {}
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server") serverUrl = args[++i] ?? "";
    else if (args[i] === "--password") password = args[++i] ?? "";
    else if (args[i] === "--socket") socketPath = args[++i] ?? socketPath;
    else if (args[i] === "--verbose" || args[i] === "-v") verbose = true;
  }

  if (!serverUrl || !password) return null;
  return { serverUrl, password, socketPath, verbose };
}

export function printForwarderHelp(): void {
  console.log(`agents-office forwarder v${VERSION}`);
  console.log("");
  console.log("Usage: agents-office forwarder [options]");
  console.log("");
  console.log("Options:");
  console.log("  --server <url>        Remote server WebSocket URL (required)");
  console.log("  --password <s>        Server password (required)");
  console.log("  --socket <path>       Local Unix socket path");
  console.log("  --verbose, -v         Verbose logging");
  console.log("  --version             Print version and exit");
  console.log("  --help                Print this help and exit");
  console.log("");
  console.log("Env vars: AGENTS_OFFICE_SERVER, AGENTS_OFFICE_PASSWORD, AGENTS_OFFICE_SOCKET, AGENTS_OFFICE_VERBOSE");
}

export function runForwarder(args: string[]): void {
  if (args.includes("--version") || args.includes("-V")) {
    console.log(VERSION);
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    printForwarderHelp();
    return;
  }

  const cfg = loadForwarderConfig(args);
  if (!cfg) {
    console.error("usage: AGENTS_OFFICE_SERVER=wss://host/hook AGENTS_OFFICE_PASSWORD=secret agents-office forwarder");
    console.error("  or:  agents-office forwarder --server wss://host/hook --password secret");
    process.exit(1);
  }

  const SOCKET_PATH = cfg.socketPath;
  const SERVER_URL = cfg.serverUrl;
  const PASSWORD = cfg.password;
  const VERBOSE = cfg.verbose;

  const log = VERBOSE ? (...args: unknown[]) => console.error("[forwarder]", ...args) : () => {};

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let sendBuf: string[] = [];

  function connectWs(): void {
    if (ws) { ws.close(); ws = null; }
    ws = new WebSocket(`${SERVER_URL}?password=${encodeURIComponent(PASSWORD)}`);

    ws.onopen = () => {
      console.error(`forwarder: connected to ${SERVER_URL}`);
      for (const msg of sendBuf.splice(0)) {
        ws!.send(msg);
        log("flushed", msg.slice(0, 80));
      }
    };

    ws.onclose = () => {
      log("ws closed");
      ws = null;
      reconnectTimer = setTimeout(connectWs, 3000);
    };

    ws.onerror = (ev) => { log("ws error", ev); ws?.close(); };

    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string);
        if (d.type === "ping") ws?.send(JSON.stringify({ type: "pong" }));
      } catch {}
    };
  }

  function send(payload: object): void {
    const withMachine = { ...(payload as Record<string, unknown>), machine_name: os.hostname() };
    const msg = JSON.stringify(withMachine);
    log("send", msg.slice(0, 120));
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(msg);
    } else {
      sendBuf.push(msg);
      if (sendBuf.length > 1000) sendBuf.shift();
    }
  }

  try { fs.unlinkSync(SOCKET_PATH); } catch {}

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

  connectWs();

  setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" })); }, 30000);
  process.on("SIGINT", () => { server.close(); process.exit(0); });
  process.on("SIGTERM", () => { server.close(); process.exit(0); });
}
