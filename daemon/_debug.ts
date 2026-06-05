import { Effect } from "effect"
import { makeDaemon } from "./src/server/http"
import { AgentsOfficeConfigLive } from "./src/services/config"
import { ConfigProvider } from "effect"

console.log("starting...")
const configProvider = ConfigProvider.fromMap(new Map())
Effect.runPromise(
  Effect.gen(function* () {
    const daemon = yield* makeDaemon()
    console.log("daemon ready")
    yield* Effect.never
  }).pipe(
    Effect.provide(AgentsOfficeConfigLive),
    Effect.withConfigProvider(configProvider),
  )
).catch((e) => { console.error("error:", e) })
console.log("after runPromise")
