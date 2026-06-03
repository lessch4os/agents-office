import { Effect, Layer } from "effect"
import { AgentsOfficeConfig, AgentsOfficeConfigLive } from "./services/config"
import { makeDaemon } from "./server/http"

const VERSION = "0.1.29"

const program = Effect.gen(function* () {
  const args = process.argv.slice(2)
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION)
    return
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`agents-office v${VERSION}
Usage: agents-office [command] [options]

Commands:
  daemon    Start the daemon server (default)
  doctor    Run diagnostics

Options:
  --port <n>        HTTP server port (default: 8080)
  --password <p>    Authentication password
  --max-desks <n>   Maximum desks per floor (default: 16)
  --verbose         Verbose logging
  --version, -v     Print version
  --help, -h        Print help
`)
    return
  }

  const daemon = yield* makeDaemon()
  console.log(`agents-office daemon v${VERSION} started`)

  yield* Effect.never
})

Effect.runPromise(program.pipe(
  Effect.provide(AgentsOfficeConfigLive),
))
