import { Effect, Layer } from "effect"
import { AgentsOfficeConfig, AgentsOfficeConfigLive } from "./services/config"
import { makeDaemon } from "./server/http"
import { runForwarder } from "./cli/forwarder"
import { runDoctor } from "./cli/doctor"
import { runReload } from "./cli/reloader"
import { runSetup } from "./cli/setup"

const VERSION = "0.1.30"

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

  const cmd = args[0]
  const cmdArgs = args.slice(1)

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
      runDaemon()
      break
  }
}

function runDaemon(): void {
  Effect.runPromise(
    Effect.gen(function* () {
      const daemon = yield* makeDaemon()
      console.log(`agents-office daemon v${VERSION} started`)
      yield* Effect.never
    }).pipe(Effect.provide(AgentsOfficeConfigLive)),
  ).catch(console.error)
}

main()
