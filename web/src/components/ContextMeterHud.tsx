import { useState } from "react"
import type { WireScene } from "../types"

const LS_KEY = "agents-office:hud:context-meter"

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

type Props = {
  scene: WireScene | null
}

export function ContextMeterHud({ scene }: Props) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(LS_KEY) === "true")

  const toggle = () => {
    setCollapsed(v => {
      const next = !v
      localStorage.setItem(LS_KEY, String(next))
      return next
    })
  }

  function ctxTokens(a: { context_total_tokens: number; context_input_tokens: number }): number {
    return a.context_total_tokens > 0 ? a.context_total_tokens : a.context_input_tokens
  }

  const agents = scene ? Object.values(scene.agents) : []
  const withContext = agents
    .filter((a) => a.context_window_limit > 0)
    .sort((a, b) => ctxTokens(b) - ctxTokens(a))
    .slice(0, 5)

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 30,
        minWidth: 200,
        background: "var(--bg-glass)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        fontFamily: "var(--font-mono)",
        color: "var(--text-on-surface)",
        fontSize: 10,
        overflow: "hidden",
        transition: "all 0.25s ease",
      }}
    >
      {/* header */}
      <div
        onClick={toggle}
        style={{
          padding: "6px 10px",
          borderBottom: collapsed ? "none" : "1px solid var(--border-subtle)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          userSelect: "none",
          fontSize: 9,
          color: "var(--text-on-surface-dim)",
          fontWeight: 600,
          letterSpacing: "0.5px",
        }}
      >
        Context Meter
        <span style={{ color: "var(--text-on-surface-faint)", fontSize: 9 }}>
          {collapsed ? "\u25B6" : "\u25BC"}
        </span>
      </div>

      {/* content */}
      <div
        style={{
          maxHeight: collapsed ? 0 : 300,
          overflow: "hidden",
          transition: "max-height 0.3s ease",
        }}
      >
        <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
          {withContext.length === 0 && (
            <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 9, padding: "4px 0" }}>
              no agents with context data
            </div>
          )}
          {withContext.map((a) => {
            const v = ctxTokens(a)
            const pct = Math.min(1, v / a.context_window_limit)
            const barColor = pct > 0.8 ? "var(--text-error)" : pct > 0.6 ? "var(--text-tertiary)" : "var(--text-primary)"
            const shortLabel = a.label || "?"
            return (
              <div key={a.agent_id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{
                    color: "var(--text-on-surface-dim)",
                    maxWidth: 100,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 9,
                  }}>
                    {shortLabel}
                  </span>
                  <span style={{ color: barColor, fontSize: 8 }}>
                    {fmtTokens(v)} / {fmtTokens(a.context_window_limit)} ({Math.round(pct * 100)}%)
                  </span>
                </div>
                {/* progress bar */}
                <div style={{
                  height: 3,
                  background: "var(--bg-surface)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}>
                  <div style={{
                    width: `${Math.round(pct * 100)}%`,
                    height: "100%",
                    background: barColor,
                    borderRadius: 2,
                    transition: "width 0.3s ease",
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
