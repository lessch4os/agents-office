import { ConfigProvider, Effect } from "effect"
import { AgentsOfficeConfig, AgentsOfficeConfigLive } from "../services/config"
import { makeDaemon } from "../server/http"

export interface TestDaemon {
  url: string
  socketPath: string
  cleanup: () => void
}

export function startTestDaemon(port: number, db = ":memory:"): Promise<TestDaemon> {
  const uid = process.getuid?.() ?? 0
  const socketPath = `/tmp/agents-office-test-${uid}.sock`

  const configProvider = ConfigProvider.fromMap(new Map([
    ["port", String(port)],
    ["socket", socketPath],
    ["db", db],
  ]))

  let daemon: { hookServer?: { close(): void }; server: { stop(): void } } | null = null
  const started = new Promise<void>((resolve) => {
    Effect.runPromise(
      Effect.gen(function* () {
        daemon = yield* makeDaemon()
        resolve()
        yield* Effect.never
      }).pipe(
        Effect.provide(AgentsOfficeConfigLive),
        Effect.withConfigProvider(configProvider),
      ),
    )
  })

  return started.then(() => ({
    url: `http://127.0.0.1:${port}`,
    socketPath,
    cleanup: () => {
      daemon?.hookServer?.close()
      daemon?.server.stop()
    },
  }))
}
