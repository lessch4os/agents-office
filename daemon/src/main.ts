import { ConfigProvider, Effect } from "effect"
import { AgentsOfficeConfig, AgentsOfficeConfigLive } from "./services/config"
import { makeDaemon } from "./server/http"
import { runForwarder } from "./cli/forwarder"
import { runDoctor } from "./cli/doctor"
import { runReload } from "./cli/reloader"
import { runSetup } from "./cli/setup"

const VERSION = "0.1.31"

function printHelp(): void {
  console.log(`agents-office v${VERSION}
Usage: agents-office [command] [options]

Commands:
  daemon                  Start the daemon server (default)
  forwarder               Forward local hooks to a remote server
  doctor                  Run diagnostics
  setup                   Interactive configuration wizard
  reload                  Graceful restart agents + daemon

Options:
  --port <n>              HTTP server port (default: 8080)
  --password <p>          Authentication password
  --max-desks <n>         Maximum desks per floor (default: 16)
  --verbose               Verbose logging
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

  const knownCommands = ["forwarder", "doctor", "reload", "setup", "daemon"]
  const cmd = knownCommands.includes(args[0]) ? args[0] : "daemon"
  const cmdArgs = cmd === "daemon" ? args : args.slice(1)

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
  const configProvider = ConfigProvider.fromMap(new Map(Object.entries(mergedFlags)))

  Effect.runPromise(
    Effect.gen(function* () {
      const daemon = yield* makeDaemon()
      console.log(`agents-office daemon v${VERSION} started`)
      yield* Effect.never
    }).pipe(
      Effect.provide(AgentsOfficeConfigLive),
      Effect.withConfigProvider(configProvider),
    ),
  ).catch(console.error)
}

main()
