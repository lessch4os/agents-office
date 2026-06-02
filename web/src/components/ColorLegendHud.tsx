import { useState } from "react"

const LS_KEY = "agents-office:hud:color-legend"

const ORIGIN_COLORS = [
  { label: "Local", color: "#44ddff", desc: "this machine" },
  { label: "Remote", color: "#ff8844", desc: "via forwarder" },
]

const SOURCE_COLORS = [
  { label: "CC", color: "#4f4", desc: "Claude Code" },
  { label: "OC", color: "#48f", desc: "OpenCode" },
  { label: "AG", color: "#84f", desc: "Antigravity" },
]

const STATE_COLORS = [
  { label: "Active", color: "#00ff41", desc: "tool running" },
  { label: "Waiting", color: "#00dcff", desc: "blocked / thinking" },
  { label: "Idle", color: "#28283c", desc: "no activity" },
]

const TOOL_COLORS = [
  { label: "Bash", color: "#ff8844" },
  { label: "Read", color: "#8844ff" },
  { label: "Write", color: "#44ff44" },
  { label: "Edit", color: "#4488ff" },
  { label: "Glob", color: "#ff44ff" },
  { label: "Agent", color: "#ffff44" },
]

export function ColorLegendHud() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(LS_KEY) === "true")

  const toggle = () => {
    setCollapsed(v => {
      const next = !v
      localStorage.setItem(LS_KEY, String(next))
      return next
    })
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 88,
        left: 24,
        zIndex: 30,
        minWidth: 150,
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
        Color Legend
        <span style={{ color: "var(--text-on-surface-faint)", fontSize: 9 }}>
          {collapsed ? "\u25B6" : "\u25BC"}
        </span>
      </div>

      <div
        style={{
          maxHeight: collapsed ? 0 : 350,
          overflow: "hidden",
          transition: "max-height 0.3s ease",
        }}
      >
        <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
          <Section title="ORIGIN">
            {ORIGIN_COLORS.map(c => <Swatch key={c.label} color={c.color} label={c.label} desc={c.desc} />)}
          </Section>
          <Section title="SOURCE">
            {SOURCE_COLORS.map(c => <Swatch key={c.label} color={c.color} label={c.label} desc={c.desc} />)}
          </Section>
          <Section title="STATE">
            {STATE_COLORS.map(c => <Swatch key={c.label} color={c.color} label={c.label} desc={c.desc} />)}
          </Section>
          <Section title="TOOLS">
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {TOOL_COLORS.map(c => (
                <span key={c.label} style={{ color: c.color, fontSize: 8, background: "rgba(0,0,0,0.3)", padding: "1px 5px", borderRadius: 3 }}>
                  {c.label}
                </span>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: "var(--text-on-surface-faint)", fontSize: 7, letterSpacing: "0.8px", marginBottom: 3 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Swatch({ color, label, desc }: { color: string; label: string; desc?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ color, fontSize: 14, lineHeight: "10px" }}>●</span>
      <span style={{ color: "var(--text-on-surface-dim)", fontSize: 9 }}>{label}</span>
      {desc && <span style={{ color: "var(--text-on-surface-faint)", fontSize: 7 }}>{desc}</span>}
    </div>
  )
}
