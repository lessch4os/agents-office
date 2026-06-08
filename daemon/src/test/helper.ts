import { Redacted } from "effect"
import { makeDaemon } from "../server/http"

export interface TestDaemon {
  url: string
  socketPath: string
  cleanup: () => void
}

export function startTestDaemon(port: number, db = ":memory:"): Promise<TestDaemon> {
  const uid = process.getuid?.() ?? 0
  const actualPort = port === 0 ? Math.floor(Math.random() * 10000) + 20000 : port
  const socketPath = `/tmp/agents-office-test-${port === 0 ? process.pid : port}.sock`

  const daemon = makeDaemon({
    port: actualPort,
    socket: socketPath,
    db: db,
    maxDesks: 16,
    webRoot: undefined,
    password: undefined,
  })

  return new Promise((resolve) => {
    setTimeout(() => resolve({
      url: `http://127.0.0.1:${actualPort}`,
      socketPath,
      cleanup: () => {
        clearInterval(daemon.processInterval)
        daemon.hookServer?.close()
        daemon.server.stop()
      },
    }), 500)
  })
}
