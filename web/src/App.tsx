import { useState, useEffect, useCallback, useRef } from "react"
import type { WireScene, WireLogEntry } from "./types"
import { connectWebSocket } from "./ws"
import { OfficePixi as Office } from "./components/OfficePixi"
import { ActivityFeed } from "./components/ActivityFeed"
import { HistoryPage } from "./components/HistoryPage"
import { PricingPage } from "./components/PricingPage"
import InstallPage from "./components/InstallPage"
import { OfficeStatsHud } from "./components/OfficeStatsHud"
import { ContextMeterHud } from "./components/ContextMeterHud"
import { ColorLegendHud } from "./components/ColorLegendHud"
import { setLiveAgentsCache } from "./liveAgentsCache"
import { fetchPricing } from "./pricing"

type Page = "office" | "history" | "pricing" | "install"

function parseHashPage(): Page {
  if (window.location.hash.startsWith("#/history")) return "history"
  if (window.location.hash.startsWith("#/pricing")) return "pricing"
  if (window.location.hash.startsWith("#/install")) return "install"
  return "office"
}

const LS_LOG_KEY = "agents-office:log-visible"
const LS_HUD_KEY = "agents-office:huds-visible"

export default function App() {
  const [page, setPage] = useState<Page>(parseHashPage)
  const [scene, setScene] = useState<WireScene | null>(null)
  const [connected, setConnected] = useState(false)
  const [logEntries, setLogEntries] = useState<WireLogEntry[]>([])
  const [logVisible, setLogVisible] = useState(() => localStorage.getItem(LS_LOG_KEY) !== "false")
  const [hudsVisible, setHudsVisible] = useState(() => localStorage.getItem(LS_HUD_KEY) !== "false")
  const logBufferRef = useRef<WireLogEntry[]>([])
  const MAX_LOGS = 500

  const toggleLogs = useCallback(() => {
    setLogVisible(v => {
      const next = !v
      localStorage.setItem(LS_LOG_KEY, String(next))
      return next
    })
  }, [])

  const toggleHuds = useCallback(() => {
    setHudsVisible(v => {
      const next = !v
      localStorage.setItem(LS_HUD_KEY, String(next))
      return next
    })
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "h") toggleLogs()
      if (e.key === "c") toggleHuds()
      if (e.key === "Escape" && (page === "history" || page === "pricing" || page === "install")) {
        window.location.hash = "/office"
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [toggleLogs, toggleHuds, page])

  const onScene = useCallback((s: WireScene) => {
    setScene(s)
    setLiveAgentsCache(Object.values(s.agents))
    if (!connected) setConnected(true)
  }, [connected])

  const onLog = useCallback((entry: WireLogEntry) => {
    const buf = logBufferRef.current
    buf.push(entry)
    if (buf.length > MAX_LOGS) buf.splice(0, buf.length - MAX_LOGS)
    setLogEntries(buf)
  }, [])

  useEffect(() => {
    const disconnect = connectWebSocket(onScene, onLog)
    fetchPricing()
    return disconnect
  }, [onScene, onLog])

  useEffect(() => {
    const handler = () => setPage(parseHashPage())
    window.addEventListener("hashchange", handler)
    return () => window.removeEventListener("hashchange", handler)
  }, [])

  useEffect(() => {
    if (page === "office") window.location.hash = "/office"
    else if (page === "pricing") window.location.hash = "/pricing"
    else if (page === "install") window.location.hash = "/install"
  }, [page])

  const agentCount = scene ? Object.keys(scene.agents).length : 0

  return (
    <div style={{
      height: "100vh",
      overflow: "hidden",
      background: "var(--bg-canvas)",
      color: "var(--text-on-surface)",
      fontFamily: "var(--font-mono)",
      padding: 20,
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
    }}>
      {/* nav */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
        borderBottom: "1px solid var(--border-subtle)",
        paddingBottom: 4,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <h1 style={{
            margin: 0,
            fontSize: 16,
            color: "var(--text-primary)",
            marginRight: 24,
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
          }}>
            agents-office
          </h1>
          <button
            onClick={() => setPage("office")}
            style={{
              background: "none",
              border: "none",
              borderBottom: page === "office" ? "2px solid var(--border-primary)" : "2px solid transparent",
              color: page === "office" ? "var(--text-primary)" : "var(--text-on-surface-subtle)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              padding: "6px 14px",
              transition: "color var(--transition-fast), border-color var(--transition-fast)",
            }}
          >
            Office
          </button>
          <button
            onClick={() => setPage("history")}
            style={{
              background: "none",
              border: "none",
              borderBottom: page === "history" ? "2px solid var(--border-primary)" : "2px solid transparent",
              color: page === "history" ? "var(--text-primary)" : "var(--text-on-surface-subtle)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              padding: "6px 14px",
              transition: "color var(--transition-fast), border-color var(--transition-fast)",
            }}
          >
            History
          </button>
          <button
            onClick={() => setPage("pricing")}
            style={{
              background: "none",
              border: "none",
              borderBottom: page === "pricing" ? "2px solid var(--border-primary)" : "2px solid transparent",
              color: page === "pricing" ? "var(--text-primary)" : "var(--text-on-surface-subtle)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              padding: "6px 14px",
              transition: "color var(--transition-fast), border-color var(--transition-fast)",
            }}
          >
            Pricing
          </button>
          <button
            onClick={() => setPage("install")}
            style={{
              background: "none",
              border: "none",
              borderBottom: page === "install" ? "2px solid var(--border-primary)" : "2px solid transparent",
              color: page === "install" ? "var(--text-primary)" : "var(--text-on-surface-subtle)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              padding: "6px 14px",
              transition: "color var(--transition-fast), border-color var(--transition-fast)",
            }}
          >
            Install
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={toggleLogs}
            style={{
              background: "none",
              border: "1px solid var(--border-default)",
              borderRadius: 4,
              color: logVisible ? "var(--text-secondary)" : "var(--text-on-surface-subtle)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              padding: "3px 10px",
              transition: "color var(--transition-fast)",
            }}
          >
            {logVisible ? "logs \u25C0" : "logs \u25B6"}
          </button>
          <button
            onClick={toggleHuds}
            title="Toggle HUD panels (c key)"
            style={{
              background: hudsVisible ? "rgba(0,229,255,0.1)" : "none",
              border: "1px solid",
              borderColor: hudsVisible ? "rgba(0,229,255,0.3)" : "var(--border-default)",
              borderRadius: 4,
              color: hudsVisible ? "var(--text-secondary)" : "var(--text-on-surface-dim)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              padding: "3px 10px",
              transition: "all var(--transition-fast)",
            }}
          >
            {hudsVisible ? "\u25A0 HUDs" : "\u25A1 HUDs"}
          </button>
          <span style={{
            color: "var(--text-on-surface-faint)",
            fontSize: 9,
            letterSpacing: "0.3px",
          }}>
            h:logs c:huds
          </span>
          <span style={{ color: connected ? "var(--text-primary)" : "var(--text-error)", fontSize: 12 }}>
            {connected ? `\u25CF ${agentCount} agents` : "\u25CB disconnected"}
          </span>
        </div>
      </div>

      {page === "office" && (
        <>
          <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1, minWidth: 0, height: "100%", opacity: hudsVisible ? 1 : 0.4, transition: "opacity 0.3s" }}>
              <Office scene={scene} logEntries={logEntries} />
            </div>
            <ActivityFeed entries={logEntries} scene={scene} visible={logVisible} />
          </div>
          {/* Floating HUD panels */}
          {hudsVisible && (
            <>
              <ColorLegendHud />
              <OfficeStatsHud scene={scene} />
              <ContextMeterHud scene={scene} />
            </>
          )}
          {!connected && (
            <p style={{ textAlign: "center", color: "var(--text-on-surface-muted)", marginTop: 40 }}>
              waiting for daemon connection...
            </p>
          )}
        </>
      )}

      {page === "history" && <HistoryPage />}
      {page === "pricing" && <PricingPage />}
      {page === "install" && <InstallPage />}
    </div>
  )
}
