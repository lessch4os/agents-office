import { useRef, useEffect, useState } from "react"
import type { WireLogEntry, WireScene } from "../types"

const TOOL_COLORS: Record<string, string> = {
  Bash: "#ff8844",
  Read: "#8844ff",
  Write: "#44ff44",
  Edit: "#4488ff",
  MultiEdit: "#4488ff",
  Glob: "#ff44ff",
  Grep: "#ff44ff",
  Agent: "#ffff44",
  Task: "#ffff44",
}

const LOG_LABELS: Record<string, string> = {
  tool_start: "START",
  tool_result: "RESULT",
  waiting: "WAIT",
  thought: "NOTE",
  error: "ERROR",
}

const LOG_BADGE_COLORS: Record<string, string> = {
  tool_start: "#00e55b",
  tool_result: "#666",
  waiting: "#e5c500",
  thought: "#00e5ff",
  error: "#ff4d4d",
}

const LS_COLLAPSED_KEY = "agents-office:feed-collapsed"

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString("en-US", { hour12: false })
}

function agentLabel(agentId: number, scene: WireScene | null): string {
  if (!scene) return `#${agentId}`
  const a = Object.values(scene.agents).find((a) => a.agent_id === agentId)
  return a?.label ?? `#${agentId}`
}

type Props = {
  entries: WireLogEntry[]
  scene: WireScene | null
  visible: boolean
}

function fmtDuration(ms: number | undefined): string {
  if (ms == null) return ""
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

type FeedEntryProps = {
  entry: WireLogEntry
  agentLabel: string
  toolColor: string
}

function FeedEntryRow({ entry, agentLabel: label, toolColor }: FeedEntryProps) {
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const badgeColor = LOG_BADGE_COLORS[entry.log_type] ?? "#888"
  const badgeLabel = LOG_LABELS[entry.log_type] ?? ""

  return (
    <div
      onClick={() => entry.tool_input && setExpanded(!expanded)}
      style={{ cursor: entry.tool_input ? "pointer" : "default" }}
    >
      <div
        style={{
          padding: "3px 12px",
          fontSize: 10,
          lineHeight: "16px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <span style={{ color: "var(--text-on-surface-faint)", flexShrink: 0, width: 52 }}>
          {fmtTime(entry.timestamp_ms)}
        </span>
        <span
          style={{
            color: "var(--text-on-surface-dim)",
            flexShrink: 0,
            maxWidth: 70,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {/* log type badge */}
        {badgeLabel && (
          <span
            style={{
              color: badgeColor,
              border: `1px solid ${badgeColor}`,
              borderRadius: 3,
              fontSize: 8,
              padding: "0 4px",
              lineHeight: "14px",
              fontWeight: 600,
              flexShrink: 0,
              letterSpacing: "0.5px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {badgeLabel}
          </span>
        )}
        {entry.tool_name && !badgeLabel && (
          <span style={{ color: toolColor, flexShrink: 0, fontSize: 9 }}>
            {entry.tool_name}
          </span>
        )}
        <span
          style={{
            color: entry.log_type === "tool_start" ? "var(--text-on-surface-bright)" : "var(--text-on-surface-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {entry.detail}
        </span>
        {entry.duration_ms != null && (
          <span style={{ color: "var(--text-on-surface-subtle)", fontSize: 8, flexShrink: 0 }}>
            {fmtDuration(entry.duration_ms)}
          </span>
        )}
        {entry.tool_input && (
          <span style={{ color: "var(--text-on-surface-faint)", fontSize: 8, flexShrink: 0 }}>
            {expanded ? "\u25B4" : "\u25BE"}
          </span>
        )}
      </div>
      {/* expandable tool input */}
      <div
        ref={contentRef}
        style={{
          maxHeight: expanded ? contentRef.current?.scrollHeight ?? 200 : 0,
          overflow: "hidden",
          transition: "max-height 0.2s ease",
        }}
      >
        {entry.tool_input && (
          <div style={{
            padding: "2px 12px 4px 72px",
            fontSize: 9,
            color: "var(--text-on-surface-muted)",
            fontStyle: "italic",
            borderBottom: "1px solid var(--border-subtle)",
            wordBreak: "break-all",
            lineHeight: "14px",
          }}>
            {entry.tool_input}
          </div>
        )}
      </div>
    </div>
  )
}

export function ActivityFeed({ entries, scene, visible }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filterSource, setFilterSource] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(LS_COLLAPSED_KEY) === "true")

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [entries.length, autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  const toggleCollapsed = () => {
    setCollapsed(v => {
      const next = !v
      localStorage.setItem(LS_COLLAPSED_KEY, String(next))
      return next
    })
  }

  const filtered = filterSource
    ? entries.filter((e) => {
        const a = scene ? Object.values(scene.agents).find((a) => a.agent_id === e.agent_id) : null
        return a?.source === filterSource
      })
    : entries

  const sources = new Set<string>()
  if (scene) {
    for (const a of Object.values(scene.agents)) sources.add(a.source)
  }

  const ghostBtn = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--bg-filter-active)" : "transparent",
    border: "1px solid",
    borderColor: active ? "var(--border-filter-active)" : "var(--border-filter-inactive)",
    borderRadius: 4,
    color: active ? "var(--text-primary)" : "var(--text-on-surface-dim)",
    cursor: "pointer",
    fontSize: 9,
    padding: "2px 8px",
    fontFamily: "var(--font-mono)",
    fontWeight: active ? 600 : 400,
    transition: "all var(--transition-fast)",
    letterSpacing: "0.5px",
  })

  return (
    <div
      style={{
        width: visible ? 320 : 0,
        minWidth: 0,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-glass)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        overflow: "hidden",
        transition: "width 0.25s ease-in-out",
      }}
    >
      {/* header */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={toggleCollapsed}
      >
        <span style={{ fontSize: 11, color: "var(--text-on-surface-dim)" }}>
          Activity Log
          {!collapsed && (
            <span style={{ marginLeft: 6, color: "var(--text-on-surface-subtle)" }}>
              ({filtered.length})
            </span>
          )}
        </span>
        <span style={{ color: "var(--text-on-surface-faint)", fontSize: 9 }}>
          {collapsed ? "\u25B6" : "\u25BC"}
        </span>
      </div>

      {/* filter pills — always visible when not collapsed */}
      {!collapsed && sources.size > 0 && (
        <div
          style={{
            padding: "4px 12px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            gap: 4,
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {[...sources].map((s) => (
            <button
              key={s}
              onClick={() => setFilterSource(filterSource === s ? null : s)}
              style={ghostBtn(filterSource === s)}
            >
              {s === "claude-code" ? "CC" : s === "antigravity" ? "AG" : s === "opencode" ? "OC" : s.slice(0, 2)}
            </button>
          ))}
          {filterSource && (
            <button
              onClick={() => setFilterSource(null)}
              style={ghostBtn(false)}
            >
              all
            </button>
          )}
        </div>
      )}

      {/* entries — animated collapse */}
      <div
        style={{
          maxHeight: collapsed || !visible ? 0 : 600,
          overflow: "hidden",
          transition: "max-height 0.3s ease",
          flex: collapsed ? 0 : 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "4px 0",
            minHeight: 0,
          }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-on-surface-subtle)", fontSize: 11 }}>
              no activity yet
            </div>
          )}
          {filtered.map((entry, i) => {
            const toolColor = entry.tool_name ? TOOL_COLORS[entry.tool_name] : "#888"
            return (
              <FeedEntryRow
                key={`${entry.timestamp_ms}-${i}`}
                entry={entry}
                agentLabel={agentLabel(entry.agent_id, scene)}
                toolColor={toolColor}
              />
            )
          })}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
