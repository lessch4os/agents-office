import net from "net"
import fs from "fs"
import os from "os"
import { Logger, getLogger } from "../services/logger"

interface FwdCfg {
  serverUrl: string
  password: string
  socketPath: string
  verbose: boolean
}

function resolveSocket(): string {
  if (process.env.AGENTS_OFFICE_SOCKET) return process.env.AGENTS_OFFICE_SOCKET
  const xdg = process.env.XDG_RUNTIME_DIR
  if (xdg) return `${xdg}/agents-office-forwarder.sock`
  return `/tmp/agents-office-forwarder-${process.getuid?.() ?? 0}.sock`
}

function daemonSocketPaths(): string[] {
  const uid = process.getuid?.() ?? 0
  const paths: string[] = []
  const xdg = process.env.XDG_RUNTIME_DIR
  if (xdg) paths.push(`${xdg}/agents-office.sock`)
  paths.push(`/run/user/${uid}/agents-office.sock`, `/tmp/agents-office-${uid}.sock`)
  return paths
}

export function runForwarder(args: string[]): void {
  let serverUrl = process.env.AGENTS_OFFICE_SERVER ?? ""
  let password = process.env.AGENTS_OFFICE_PASSWORD ?? ""
  let verbose = !!process.env.AGENTS_OFFICE_VERBOSE
  let socketPath = resolveSocket()

  const home = process.env.HOME ?? "/tmp"
  try {
    const cfg = JSON.parse(fs.readFileSync(`${home}/.agents-office/config.json`, "utf-8")) as Record<string, string>
    if (!serverUrl) serverUrl = cfg.server_url ?? ""
    if (!password) password = cfg.password ?? ""
    if (!verbose) verbose = cfg.verbose === "true"
  } catch {}

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server") serverUrl = args[++i] ?? ""
    else if (args[i] === "--password") password = args[++i] ?? ""
    else if (args[i] === "--socket") socketPath = args[++i] ?? socketPath
    else if (args[i] === "--verbose" || args[i] === "-v") verbose = true
  }

  if (!serverUrl || !password) {
    const log = getLogger()
    log.error("usage: AGENTS_OFFICE_SERVER=wss://host/hook AGENTS_OFFICE_PASSWORD=secret agents-office forwarder", {})
    log.error("  or:  agents-office forwarder --server wss://host/hook --password secret", {})
    process.exit(1)
  }

  const log = getLogger().child("forwarder")

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const sendBuf: string[] = []
  const createdSymlinks: string[] = []

  function connectWs() {
    if (ws) { ws.close(); ws = null }
    ws = new WebSocket(`${serverUrl}?password=${encodeURIComponent(password)}`)
    ws.onopen = () => {
      log.info("forwarder connected", { serverUrl })
      while (sendBuf.length > 0) { ws!.send(sendBuf.shift()!) }
    }
    ws.onclose = () => { ws = null; reconnectTimer = setTimeout(connectWs, 3000) }
    ws.onerror = () => ws?.close()
    ws.onmessage = (ev) => {
      try { const d = JSON.parse(ev.data as string); if (d.type === "ping") ws?.send(JSON.stringify({ type: "pong" })) } catch {}
    }
  }

  function send(payload: object) {
    const msg = JSON.stringify({ ...(payload as Record<string, unknown>), machine_name: os.hostname() })
    log.debug("forwarder send", { msg: msg.slice(0, 120) })
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg)
    else { sendBuf.push(msg); if (sendBuf.length > 1000) sendBuf.shift() }
  }

  try { fs.unlinkSync(socketPath) } catch {}

  const server = net.createServer((socket) => {
    let buf = ""
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString()
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try { const payload = JSON.parse(trimmed); log.debug("forwarder received", { sessionId: payload.session_id as string }); send(payload) }
        catch {}
      }
    })
    socket.on("error", () => {})
  })

  server.listen(socketPath, () => {
    log.info("forwarder listening", { socketPath })
    for (const link of daemonSocketPaths()) {
      if (link === socketPath) continue
      try { fs.unlinkSync(link) } catch {}
      try { fs.symlinkSync(socketPath, link); createdSymlinks.push(link); log.info("forwarder symlink", { link, target: socketPath }) } catch {}
    }
  })

  connectWs()
  setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" })) }, 30000)
  process.on("SIGINT", () => { for (const l of createdSymlinks) try { fs.unlinkSync(l) } catch {}; server.close(); process.exit(0) })
  process.on("SIGTERM", () => { for (const l of createdSymlinks) try { fs.unlinkSync(l) } catch {}; server.close(); process.exit(0) })
}
