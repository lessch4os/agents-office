import { Redacted } from "effect"
import { makeDaemon } from "./server/http"
import { runForwarder } from "./cli/forwarder"
import { runDoctor } from "./cli/doctor"
import { runReload } from "./cli/reloader"
import { runSetup } from "./cli/setup"
import { runDbMigrate } from "./cli/db-migrate"
import { Logger, getLogger, setLogger } from "./services/logger"

const VERSION = "0.1.33"

function setupLogger(level: number, component: string): Logger {
  const log = new Logger(level, component)
  log.setFileAppender(`${process.env.HOME ?? "/tmp"}/.agents-office/logs`)
  setLogger(log)
  return log
}

function printHelp(): void {
  console.log(`agents-office v${VERSION}
Usage: agents-office [command] [options]

Commands:
  daemon                  Start the daemon server (default)
  forwarder               Forward local hooks to a remote server
  doctor                  Run diagnostics
  db-migrate              Apply pending database migrations
  setup                   Interactive configuration wizard
  reload                  Graceful restart agents + daemon

Options:
  --port <n>              HTTP server port (default: 8080)
  --password <p>          Authentication password
  --max-desks <n>         Maximum desks per floor (default: 16)
  --web-root <path>       Path to web frontend build output
  --socket <path>         Unix socket path for hook shim
  --db <path>             SQLite database path
  --log <level>           Log verbosity (1-10, default: 3)
  --log-type <filter>     Component filter: all,daemon,forwarder,doctor,setup (default: all)
  --verbose               Shorthand for --log 10
  --version, -v           Print version
  --help, -h              Print this help

See 'agents-office <command> --help' for command-specific options.
`)
}

function parseCliFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--port": flags.port = args[++i]; break
      case "--password": flags.password = args[++i]; break
      case "--max-desks": flags.max_desks = args[++i]; break
      case "--web-root": flags.web_root = args[++i]; break
      case "--socket": flags.socket = args[++i]; break
      case "--projects-root": flags.projects_root = args[++i]; break
      case "--ag-brain-root": flags.ag_brain_root = args[++i]; break
      case "--opencode-sse-url": flags.opencode_sse_url = args[++i]; break
      case "--db": flags.db = args[++i]; break
      case "--relay-to": flags.relay_to = args[++i]; break
      case "--log": flags.log = args[++i]; break
      case "--log-type": flags.log_type = args[++i]; break
      case "--verbose": flags.verbose = "true"; break
      case "--version": case "-v": case "--help": case "-h": break
    }
  }
  return flags
}

function main(): void {
  const args = process.argv.slice(2)

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION)
    return
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelp()
    return
  }

  const knownCommands = ["forwarder", "doctor", "reload", "setup", "db-migrate", "daemon"]
  const rawCmd = args[0]?.replace(/^--/, "") ?? ""
  const cmd = knownCommands.includes(rawCmd) ? rawCmd : "daemon"
  const cmdArgs = cmd === "daemon" ? args : args.slice(1)

  // Setup logger from CLI flags (parsed from raw args)
  const logIdx = args.indexOf("--log")
  const logLevel = logIdx >= 0 ? parseInt(args[logIdx + 1], 10) : (args.includes("--verbose") ? 10 : 3)
  const typeIdx = args.indexOf("--log-type")
  const logType = typeIdx >= 0 ? args[typeIdx + 1] : "all"
  setupLogger(isNaN(logLevel) ? 3 : logLevel, logType)

  switch (cmd) {
    case "forwarder":
      runForwarder(cmdArgs)
      break
    case "doctor":
      runDoctor()
      break
    case "reload":
      runReload(cmdArgs).catch(console.error)
      break
    case "setup":
      runSetup().catch(console.error)
      break
    case "db-migrate":
      runDbMigrate(cmdArgs)
      break
    case "daemon":
    default:
      runDaemon(cmdArgs)
      break
  }
}

function runDaemon(cmdArgs: string[]): void {
  const cliFlags = parseCliFlags(cmdArgs)
  const envFlags: Record<string, string> = {}
  const envMap: Record<string, string> = {
    PORT: "port", PASSWORD: "password", MAX_DESKS: "max_desks",
    WEB_ROOT: "web_root", SOCKET: "socket", DB: "db",
    PROJECTS_ROOT: "projects_root", AG_BRAIN_ROOT: "ag_brain_root",
    OPENCODE_SSE_URL: "opencode_sse_url", RELAY_TO: "relay_to", VERBOSE: "verbose",
  }
  for (const [envKey, cfgKey] of Object.entries(envMap)) {
    const val = process.env[envKey]
    if (val) envFlags[cfgKey] = val
  }
  const mergedFlags = { ...envFlags, ...cliFlags }

  const port = parseInt(mergedFlags.port ?? "8080", 10)
  const maxDesks = parseInt(mergedFlags.max_desks ?? "16", 10)
  const home = process.env.HOME ?? "/tmp"
  const uid = process.getuid?.() ?? 0
  const xdg = process.env.XDG_RUNTIME_DIR

  const cfg = {
    port,
    maxDesks,
    db: mergedFlags.db ?? `${home}/.agents-office/sessions.db`,
    socket: mergedFlags.socket ?? (xdg ? `${xdg}/agents-office.sock` : `/tmp/agents-office-${uid}.sock`),
    webRoot: mergedFlags.web_root || undefined,
    password: mergedFlags.password ? Redacted.fromString(mergedFlags.password) : undefined,
  }

  const daemon = makeDaemon(cfg)
  const log = getLogger()
  log.warn(`agents-office daemon v${VERSION} started`, { version: VERSION })

  process.on("SIGTERM", () => { clearInterval(daemon.processInterval); daemon.hookServer?.close(); daemon.server.stop(); process.exit(0) })
  process.on("SIGINT", () => { clearInterval(daemon.processInterval); daemon.hookServer?.close(); daemon.server.stop(); process.exit(0) })
}

main()
