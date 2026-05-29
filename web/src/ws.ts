import type { WireScene, WireLogEntry } from "./types"

export type SceneCallback = (scene: WireScene) => void
export type LogCallback = (entry: WireLogEntry) => void

export function connectWebSocket(onScene: SceneCallback, onLog?: LogCallback): () => void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:"
  const url = `${protocol}//${location.host}/ws`
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  async function ensureAuthed(): Promise<boolean> {
    try {
      const res = await fetch("/api/sessions")
      if (res.status === 401) { window.location.href = "/login"; return false }
      return true
    } catch { return true }
  }

  function connect() {
    ws = new WebSocket(url)

    ws.onopen = () => {
      console.log("WebSocket connected")
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === "log" && onLog) {
          onLog(msg.data as WireLogEntry)
        } else if ("agents" in msg && typeof msg.max_desks === "number") {
          onScene(msg as WireScene)
        } else if (msg.type === "scene") {
          onScene(msg.data as WireScene)
        }
      } catch (e) {
        console.error("Failed to parse WS message:", e)
      }
    }

    ws.onclose = () => {
      console.log("WebSocket disconnected, reconnecting in 2s")
      reconnectTimer = setTimeout(connect, 2000)
    }

    ws.onerror = (e) => {
      console.error("WebSocket error:", e)
    }
  }

  ensureAuthed().then((authed) => { if (authed) connect() })

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (ws) ws.close()
  }
}
