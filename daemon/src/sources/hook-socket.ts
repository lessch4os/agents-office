import net from "net"
import fs from "fs"
import path from "path"
import { decodeHookPayload } from "../decoders/hook-decoder"
import type { AgentEvent } from "../schemas/agent-event"
import { hashAgentId } from "../schemas/agent-id"
import { getLogger } from "../services/logger"

const log = getLogger()

const MAX_CONCURRENT_CONNS = 128
const MAX_PAYLOAD_BYTES = 65536

function createCompatSymlinks(actualPath: string): void {
  const dirPath = path.dirname(actualPath)
  const commonDirs = ["/run/user/0", "/run/user/1000"].filter(d => d !== dirPath)
  for (const dir of commonDirs) {
    const link = `${dir}/agents-office.sock`
    try { fs.unlinkSync(link) } catch {}
    try {
      fs.symlinkSync(actualPath, link)
      log.info("hook symlink", { link, target: actualPath })
    } catch {}
  }
}

export interface HookSocketServer {
  close(): void
}

export function startHookSocket(
  socketPath: string,
  onEvent: (event: AgentEvent, transport: string) => void,
  onRawPayload?: (parsed: Record<string, unknown>, raw: string) => void,
): HookSocketServer {
  try { fs.unlinkSync(socketPath) } catch {}
  createCompatSymlinks(socketPath)

  let activeConns = 0
  const server = net.createServer()

  server.on("error", (err) => { log.error("hook socket error", { error: String(err) }) })

  server.on("connection", (socket) => {
    if (activeConns >= MAX_CONCURRENT_CONNS) { socket.destroy(); return }
    activeConns++
    socket.setTimeout(30000)

    let buffer = ""
    socket.on("data", (data: Buffer) => {
      buffer += data.toString("utf-8")
      if (buffer.length > MAX_PAYLOAD_BYTES) { socket.destroy(); return }
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let parsed: Record<string, unknown>
        try { parsed = JSON.parse(trimmed) } catch { continue }

        onRawPayload?.(parsed, trimmed)

        const result = decodeHookPayload(parsed, hashAgentId)
        if (result._tag === "Right") {
          const source = result.right.ctx.source
          for (const ev of result.right.events) {
            onEvent(ev, source)
          }
        }
      }
    })

    socket.on("close", () => { activeConns-- })
    socket.on("error", () => { activeConns-- })
    socket.on("timeout", () => { socket.destroy() })
  })

  server.listen(socketPath, () => {
    log.warn("hook socket listening", { socketPath })
  })
  return { close: () => { server.close(); try { fs.unlinkSync(socketPath) } catch {} } }
}
