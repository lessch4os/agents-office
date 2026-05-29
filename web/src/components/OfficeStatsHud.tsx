import { useState } from "react"
import type { WireScene } from "../types"

const LS_KEY = "agents-office:hud:office-stats"

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

type Props = {
  scene: WireScene | null
}

export function OfficeStatsHud({ scene }: Props) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(LS_KEY) === "true")

  const toggle = () => {
    setCollapsed(v => {
      const next = !v
      localStorage.setItem(LS_KEY, String(next))
      return next
    })
  }

  const agents = scene ? Object.values(scene.agents) : []
  const total = agents.length
  const active = agents.filter((a) => a.state.type === "Active").length
  const waiting = agents.filter((a) => a.state.type === "Waiting").length
  const totalTokens = agents.reduce((s, a) => s + a.session_total_tokens, 0)
  const totalTools = agents.reduce((s, a) => s + a.tool_call_count, 0)

  return (
    <div
      style={{
        position: "fixed",
        top: 88,
        right: 24,
        zIndex: 30,
        minWidth: 160,
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
        Office Stats
        <span style={{ color: "var(--text-on-surface-faint)", fontSize: 9 }}>
          {collapsed ? "\u25B6" : "\u25BC"}
        </span>
      </div>

      {/* content */}
      <div
        style={{
          maxHeight: collapsed ? 0 : 200,
          overflow: "hidden",
          transition: "max-height 0.3s ease",
        }}
      >
        <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
          <Row label="Agents" value={String(total)} color="var(--text-on-surface)" />
          <Row label="Active" value={String(active)} color="var(--text-primary)" />
          <Row label="Waiting" value={String(waiting)} color="var(--text-tertiary)" />
          <Row label="Tools" value={fmtTokens(totalTools)} color="var(--text-on-surface-dim)" />
          {totalTokens > 0 && (
            <Row label="Tokens" value={fmtTokens(totalTokens)} color="var(--text-on-surface-dim)" />
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ color: "var(--text-on-surface-subtle)" }}>{label}</span>
      <span style={{ color, fontWeight: 600 }}>{value}</span>
    </div>
  )
}
