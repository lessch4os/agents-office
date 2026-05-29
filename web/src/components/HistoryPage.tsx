import { useState, useEffect, useRef, useCallback } from "react"
import type { WireSessionSummary, WireSessionDetail, WireSessionComparison, WireTokenSnapshot } from "../types"
import { getContextWindow } from "../contextWindow"
import { getPricing } from "../pricing"

// ── Formatters ─────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtCost(usd: number): string {
  if (usd === 0) return "$0.00"
  if (usd < 0.000_1) return `$${usd.toFixed(7)}`
  if (usd < 0.001) return `$${usd.toFixed(6)}`
  if (usd < 0.01) return `$${usd.toFixed(5)}`
  if (usd < 0.1) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(3)}`
}

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

function shortCwd(cwd: string): string {
  if (!cwd) return "—"
  const parts = cwd.split("/")
  return parts[parts.length - 1] || cwd
}

// ── Source badge ───────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  "claude-code": "#4f4",
  "antigravity": "#4af",
  "opencode": "#fa4",
}

function SourceBadge({ source }: { source: string }) {
  const color = SOURCE_COLORS[source] ?? "var(--text-on-surface-dim)"
  const label = source === "claude-code" ? "cc" : source === "antigravity" ? "ag" : source.slice(0, 2)
  return (
    <span style={{
      color,
      border: `1px solid ${color}`,
      borderRadius: 3,
      fontSize: 9,
      padding: "1px 4px",
      opacity: 0.8,
    }}>
      {label}
    </span>
  )
}

// ── Token sparkline ────────────────────────────────────────────────

function TokenChart({ snapshots, width, height }: { snapshots: WireTokenSnapshot[], width: number, height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || snapshots.length < 2) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.clearRect(0, 0, width, height)

    const pad = 4
    const w = width - pad * 2
    const h = height - pad * 2

    const maxVal = Math.max(...snapshots.map((s) => s.cumul_input + s.cumul_cache + s.cumul_output), 1)
    const minTs = snapshots[0]!.ts
    const maxTs = snapshots[snapshots.length - 1]!.ts
    const tsRange = Math.max(maxTs - minTs, 1)

    const toX = (ts: number) => pad + ((ts - minTs) / tsRange) * w
    const toY = (val: number) => pad + h - (val / maxVal) * h

    const drawLine = (values: number[], color: string, lineWidth = 1) => {
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      snapshots.forEach((s, i) => {
        const x = toX(s.ts)
        const y = toY(values[i]!)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke()
    }

    // fill under total cost area
    const totalVals = snapshots.map((s) => s.cumul_input + s.cumul_cache)
    ctx.beginPath()
    ctx.fillStyle = "rgba(79,255,79,0.05)"
    snapshots.forEach((s, i) => ctx.lineTo(toX(s.ts), toY(totalVals[i]!)))
    ctx.lineTo(toX(snapshots[snapshots.length - 1]!.ts), toY(0))
    ctx.lineTo(toX(snapshots[0]!.ts), toY(0))
    ctx.closePath()
    ctx.fill()

    drawLine(snapshots.map((s) => s.cumul_cache), "rgba(255,220,80,0.7)", 1.5)
    drawLine(totalVals, "rgba(79,255,79,0.8)", 1.5)
    drawLine(snapshots.map((s) => s.cumul_output), "rgba(80,160,255,0.6)", 1)
  }, [snapshots, width, height])

  if (snapshots.length < 2) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 10 }}>
        no data
      </div>
    )
  }
  return <canvas ref={ref} width={width} height={height} style={{ display: "block" }} />
}

// ── Stats row ──────────────────────────────────────────────────────

function StatRow({ label, value, sub }: { label: string, value: string, sub?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ color: "var(--text-on-surface-muted)", fontSize: 11 }}>{label}</span>
      <span style={{ color: "#aaa", fontSize: 11 }}>
        {value}
        {sub && <span style={{ color: "var(--text-on-surface-subtle)", marginLeft: 6, fontSize: 10 }}>{sub}</span>}
      </span>
    </div>
  )
}

// ── Session list ───────────────────────────────────────────────────

interface SessionListProps {
  onSelect: (id: string) => void
  onCompare: (a: string, b: string) => void
}

function SessionList({ onSelect, onCompare }: SessionListProps) {
  const [sessions, setSessions] = useState<WireSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [tagFilter, setTagFilter] = useState("")
  const [sourceFilter, setSourceFilter] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const LIMIT = 50

  const fetchSessions = useCallback(async (reset = false) => {
    setLoading(true)
    setError(null)
    const currentOffset = reset ? 0 : offset
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(currentOffset),
      })
      if (tagFilter) params.set("tag", tagFilter)
      if (sourceFilter) params.set("source", sourceFilter)
      const res = await fetch(`/api/sessions?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as WireSessionSummary[]
      setSessions((prev) => reset ? data : [...prev, ...data])
      setHasMore(data.length === LIMIT)
      if (!reset) setOffset(currentOffset + LIMIT)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [offset, tagFilter, sourceFilter])

  useEffect(() => {
    setOffset(0)
    setSessions([])
    setSelected(new Set())
    fetchSessions(true)
  }, [tagFilter, sourceFilter, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 2) next.add(id)
      return next
    })
  }

  const selArr = Array.from(selected)

  const cellStyle: React.CSSProperties = { padding: "6px 8px", fontSize: 11, borderBottom: "1px solid rgba(255,255,255,0.04)", whiteSpace: "nowrap" }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="filter by tag…"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          style={{ background: "var(--bg-surface)", border: "1px solid #333", color: "#ccc", borderRadius: 4, padding: "4px 8px", fontSize: 11, fontFamily: "var(--font-mono)", width: 130 }}
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          style={{ background: "var(--bg-surface)", border: "1px solid #333", color: "#ccc", borderRadius: 4, padding: "4px 6px", fontSize: 11, fontFamily: "monospace" }}
        >
          <option value="">all sources</option>
          <option value="claude-code">claude-code</option>
          <option value="antigravity">antigravity</option>
          <option value="opencode">opencode</option>
        </select>
        {selected.size === 2 && (
          <button
            onClick={() => onCompare(selArr[0]!, selArr[1]!)}
            style={{ background: "#1a3a1a", border: "1px solid #4f4", color: "#4f4", borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            Compare selected
          </button>
        )}
        {selected.size > 0 && (
          <button
            onClick={() => setSelected(new Set())}
            style={{ background: "none", border: "1px solid #444", color: "var(--text-on-surface-muted)", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            Clear
          </button>
        )}
        <span style={{ color: "var(--text-on-surface-subtle)", fontSize: 10, marginLeft: "auto" }}>
          {selected.size > 0 ? `${selected.size}/2 selected` : "click to inspect · select 2 to compare"}
        </span>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          title="refresh"
          style={{ background: "none", border: "1px solid #333", color: "var(--text-on-surface-muted)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          ↻
        </button>
      </div>

      {/* table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {error && <div style={{ color: "#f84", padding: 12, fontSize: 11 }}>{error}</div>}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ color: "var(--text-on-surface-subtle)", fontSize: 10 }}>
              <th style={{ ...cellStyle, width: 20 }}></th>
              <th style={{ ...cellStyle, textAlign: "left" }}>Label</th>
              <th style={{ ...cellStyle, textAlign: "left" }}>Src</th>
              <th style={{ ...cellStyle, textAlign: "left" }}>CWD</th>
              <th style={{ ...cellStyle, textAlign: "right" }}>Date</th>
              <th style={{ ...cellStyle, textAlign: "right" }}>Tools</th>
              <th style={{ ...cellStyle, textAlign: "right" }}>Active</th>
              <th style={{ ...cellStyle, textAlign: "right" }}>Cost</th>
              <th style={{ ...cellStyle, textAlign: "right" }}>Cache%</th>
              <th style={{ ...cellStyle, textAlign: "left" }}>Tags</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const isSelected = selected.has(s.session_id)
              return (
                <tr
                  key={s.session_id}
                  style={{
                    background: isSelected ? "rgba(79,255,79,0.06)" : "transparent",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isSelected ? "rgba(79,255,79,0.06)" : "transparent" }}
                >
                  <td style={cellStyle}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(s.session_id)}
                      onClick={(e) => e.stopPropagation()}
                      disabled={!isSelected && selected.size >= 2}
                      style={{ cursor: "pointer" }}
                    />
                  </td>
                  <td
                    style={{ ...cellStyle, color: "#ccc", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}
                    onClick={() => onSelect(s.session_id)}
                  >
                    {s.parent_session_id && <span style={{ color: "var(--text-on-surface-subtle)", marginRight: 4 }}>↳</span>}
                    {s.label}
                  </td>
                  <td style={cellStyle} onClick={() => onSelect(s.session_id)}>
                    <SourceBadge source={s.source} />
                  </td>
                  <td style={{ ...cellStyle, color: "var(--text-on-surface-muted)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }} onClick={() => onSelect(s.session_id)}>
                    {shortCwd(s.cwd)}
                  </td>
                  <td style={{ ...cellStyle, color: "var(--text-on-surface-muted)", textAlign: "right" }} onClick={() => onSelect(s.session_id)}>
                    {timeAgo(s.started_at)}
                  </td>
                  <td style={{ ...cellStyle, color: "#aaa", textAlign: "right" }} onClick={() => onSelect(s.session_id)}>
                    {s.tool_call_count}
                  </td>
                  <td style={{ ...cellStyle, color: "var(--text-on-surface-dim)", textAlign: "right" }} onClick={() => onSelect(s.session_id)}>
                    {fmtDuration(s.active_ms)}
                  </td>
                  <td style={{ ...cellStyle, color: s.cost_usd > 0.01 ? "#f84" : "#4f4", textAlign: "right", fontVariantNumeric: "tabular-nums" }} onClick={() => onSelect(s.session_id)}>
                    {fmtCost(s.cost_usd)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", color: s.cache_hit_rate > 0.7 ? "#4f4" : s.cache_hit_rate > 0.4 ? "#ff4" : "var(--text-on-surface-dim)" }} onClick={() => onSelect(s.session_id)}>
                    {s.cache_hit_rate > 0 ? fmtPct(s.cache_hit_rate) : "—"}
                  </td>
                  <td style={cellStyle} onClick={() => onSelect(s.session_id)}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {s.tags.map((t) => (
                        <span key={t} style={{ background: "#1a2a1a", border: "1px solid #3a5a3a", color: "#6f6", borderRadius: 3, fontSize: 9, padding: "1px 5px" }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {loading && <div style={{ color: "var(--text-on-surface-subtle)", padding: 16, textAlign: "center", fontSize: 11 }}>loading…</div>}
        {!loading && sessions.length === 0 && (
          <div style={{ color: "var(--text-on-surface-subtle)", padding: 32, textAlign: "center", fontSize: 11 }}>
            no sessions recorded yet
            <br />
            <span style={{ fontSize: 10, color: "#444" }}>sessions are tracked when the daemon is running</span>
          </div>
        )}
        {hasMore && !loading && (
          <div style={{ textAlign: "center", padding: 12 }}>
            <button
              onClick={() => fetchSessions(false)}
              style={{ background: "none", border: "1px solid #333", color: "var(--text-on-surface-muted)", borderRadius: 4, padding: "4px 16px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11 }}
            >
              load more
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Session detail ─────────────────────────────────────────────────

interface SessionDetailProps {
  sessionId: string
  onBack: () => void
  onCompareWith: (id: string) => void
}

function SessionDetail({ sessionId, onBack, onCompareWith }: SessionDetailProps) {
  const [detail, setDetail] = useState<WireSessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newTag, setNewTag] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d as WireSessionDetail); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [sessionId, refreshKey])

  const addTag = async () => {
    if (!newTag.trim() || !detail) return
    await fetch(`/api/sessions/${sessionId}/tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: newTag.trim() }),
    })
    setDetail({ ...detail, tags: [...detail.tags.filter((t) => t !== newTag.trim()), newTag.trim()] })
    setNewTag("")
  }

  const removeTag = async (tag: string) => {
    if (!detail) return
    await fetch(`/api/sessions/${sessionId}/tag/${encodeURIComponent(tag)}`, { method: "DELETE" })
    setDetail({ ...detail, tags: detail.tags.filter((t) => t !== tag) })
  }

  if (loading) return <div style={{ color: "var(--text-on-surface-subtle)", padding: 32, textAlign: "center", fontSize: 11 }}>loading…</div>
  if (error || !detail) return <div style={{ color: "#f84", padding: 16, fontSize: 11 }}>{error ?? "not found"}</div>

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "auto" }}>
      {/* back + actions */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{ background: "none", border: "1px solid #333", color: "var(--text-on-surface-dim)", borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          ← back
        </button>
        <SourceBadge source={detail.source} />
        <span style={{ color: "#ccc", fontSize: 13, fontWeight: "bold" }}>{detail.label}</span>
        {detail.agent_type && <span style={{ color: "var(--text-on-surface-muted)", fontSize: 10 }}>[{detail.agent_type}]</span>}
        <button
          onClick={() => onCompareWith(sessionId)}
          style={{ marginLeft: "auto", background: "none", border: "1px solid #444", color: "var(--text-on-surface-dim)", borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          Compare with…
        </button>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          title="refresh"
          style={{ background: "none", border: "1px solid #333", color: "var(--text-on-surface-muted)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          ↻
        </button>
      </div>

      {/* meta */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16, flexShrink: 0 }}>
        <div>
          <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10 }}>CWD</div>
          <div style={{ color: "var(--text-on-surface-dim)", fontSize: 11, wordBreak: "break-all" }}>{detail.cwd || "—"}</div>
        </div>
        <div>
          <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10 }}>Session ID</div>
          <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10, wordBreak: "break-all" }}>{detail.session_id}</div>
        </div>
        <div>
          <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10 }}>Started</div>
          <div style={{ color: "var(--text-on-surface-dim)", fontSize: 11 }}>{new Date(detail.started_at).toLocaleString()}</div>
        </div>
        <div>
          <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10 }}>Duration</div>
          <div style={{ color: "var(--text-on-surface-dim)", fontSize: 11 }}>
            {detail.ended_at ? fmtDuration(detail.ended_at - detail.started_at) : "live"}
          </div>
        </div>
      </div>

      {/* token chart */}
      {detail.snapshots.length >= 2 && (
        <div style={{ marginBottom: 16, flexShrink: 0 }}>
          <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10, marginBottom: 6 }}>Token usage over time</div>
          <div style={{ background: "#111", borderRadius: 6, padding: 8 }}>
            <TokenChart snapshots={detail.snapshots} width={560} height={100} />
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
            <span style={{ color: "rgba(79,255,79,0.8)", fontSize: 9 }}>── input+cache total</span>
            <span style={{ color: "rgba(255,220,80,0.7)", fontSize: 9 }}>── cache reads</span>
            <span style={{ color: "rgba(80,160,255,0.6)", fontSize: 9 }}>── output</span>
          </div>
        </div>
      )}

      {/* stats */}
      <div style={{ marginBottom: 16, flexShrink: 0, maxWidth: 400 }}>
        <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10, marginBottom: 4 }}>Stats (this agent)</div>
        {(() => {
          const p = getPricing(detail.model_name)
          return (<>
            <StatRow label="Input tokens" value={fmtTokens(detail.input_tokens)} sub={fmtCost(detail.input_tokens * p.inputPerM / 1_000_000)} />
            <StatRow label="Output tokens" value={fmtTokens(detail.output_tokens)} sub={fmtCost(detail.output_tokens * p.outputPerM / 1_000_000)} />
            <StatRow label="Cache reads" value={fmtTokens(detail.cache_read_tokens)} sub={fmtCost(detail.cache_read_tokens * p.cacheReadPerM / 1_000_000)} />
          </>)
        })()}
        <div style={{ height: 4 }} />
        <StatRow label="Total cost" value={fmtCost(detail.cost_usd)} />
        <StatRow label="Cache hit rate" value={fmtPct(detail.cache_hit_rate)} />
        <StatRow label="Tool calls" value={String(detail.tool_call_count)} />
        <StatRow label="Active time" value={fmtDuration(detail.active_ms)} />
        {(() => {
          const cw = getContextWindow(sessionId, detail.context_window_limit, detail.snapshots)
          if (!cw) return null
          return (
            <>
              <div style={{ height: 4 }} />
              <StatRow label="Context window" value={`${fmtTokens(cw.used)} / ${fmtTokens(cw.limit)} (${Math.round(cw.pct * 100)}%)`} />
              <div style={{ marginTop: 2, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.round(cw.pct * 100)}%`, height: "100%", background: cw.pct > 0.8 ? "#f84" : cw.pct > 0.5 ? "#ff4" : "#4f4", borderRadius: 3 }} />
              </div>
            </>
          )
        })()}
        {detail.children.length > 0 && (
          <>
            <div style={{ height: 4 }} />
            <StatRow label="Total cost (incl. children)" value={fmtCost(detail.total_cost_usd)} />
          </>
        )}
      </div>

      {/* children */}
      {detail.children.length > 0 && (
        <div style={{ marginBottom: 16, flexShrink: 0 }}>
          <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10, marginBottom: 6 }}>Sub-agents ({detail.children.length})</div>
          {detail.children.map((c) => (
            <div key={c.session_id} style={{ marginLeft: 12, marginBottom: 8, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 4, borderLeft: "2px solid #2a2a2a" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "#aaa", fontSize: 11 }}>{c.label}</span>
                <span style={{ color: "#4f4", fontSize: 11 }}>{fmtCost(c.cost_usd)}</span>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 10, color: "var(--text-on-surface-muted)" }}>
                <span>{fmtTokens(c.input_tokens)} in</span>
                <span>{fmtTokens(c.output_tokens)} out</span>
                <span>{fmtTokens(c.cache_read_tokens)} cache</span>
                <span>{c.tool_call_count} tools</span>
                <span style={{ color: c.cache_hit_rate > 0.7 ? "#4f4" : "var(--text-on-surface-dim)" }}>{fmtPct(c.cache_hit_rate)} cache%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* tags */}
      <div style={{ marginBottom: 16, flexShrink: 0 }}>
        <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10, marginBottom: 6 }}>Tags</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {detail.tags.map((t) => (
            <span key={t} style={{ background: "#1a2a1a", border: "1px solid #3a5a3a", color: "#6f6", borderRadius: 3, fontSize: 10, padding: "2px 8px", display: "flex", alignItems: "center", gap: 4 }}>
              {t}
              <button
                onClick={() => removeTag(t)}
                style={{ background: "none", border: "none", color: "#4a4a4a", cursor: "pointer", padding: 0, fontSize: 11, lineHeight: 1 }}
              >
                ✕
              </button>
            </span>
          ))}
          <div style={{ display: "flex", gap: 4 }}>
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTag() }}
              placeholder="add tag…"
              style={{ background: "var(--bg-surface)", border: "1px solid #333", color: "#ccc", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontFamily: "var(--font-mono)", width: 90 }}
            />
            <button
              onClick={addTag}
              style={{ background: "none", border: "1px solid #333", color: "var(--text-on-surface-muted)", borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10 }}
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Session picker ─────────────────────────────────────────────────

interface SessionPickerProps {
  value: string
  onChange: (id: string) => void
  sessions: WireSessionSummary[]
  placeholder?: string
  exclude?: string
}

function SessionPicker({ value, onChange, sessions, placeholder = "search sessions…", exclude }: SessionPickerProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)

  const selected = sessions.find((s) => s.session_id === value)

  const filtered = sessions
    .filter((s) => s.session_id !== exclude)
    .filter((s) => {
      if (!query) return true
      const q = query.toLowerCase()
      return s.session_id.startsWith(query) ||
        s.label.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
    })
    .slice(0, 8)

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-surface)", border: "1px solid #333", color: "#ccc", borderRadius: 4,
    padding: "4px 8px", fontSize: 11, fontFamily: "var(--font-mono)", width: 260, outline: "none",
  }

  return (
    <div style={{ position: "relative", width: 280 }}>
      {selected && !open ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface)", border: "1px solid #4f4", borderRadius: 4, padding: "4px 8px", width: 260 }}>
          <span style={{ color: "#ccc", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selected.label}
          </span>
          <button
            onClick={() => { onChange(""); setQuery("") }}
            style={{ background: "none", border: "none", color: "var(--text-on-surface-muted)", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      ) : (
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (value) onChange("") }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          style={inputStyle}
        />
      )}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 2px)", left: 0,
          background: "var(--bg-glass-heavy)", border: "1px solid #444", borderRadius: 4,
          zIndex: 20, width: 320, maxHeight: 280, overflow: "auto", boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        }}>
          {filtered.length === 0 ? (
            <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 11, padding: 12, textAlign: "center" }}>no results</div>
          ) : filtered.map((s) => (
            <div
              key={s.session_id}
              onMouseDown={() => { onChange(s.session_id); setQuery(""); setOpen(false) }}
              style={{ padding: "7px 10px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <SourceBadge source={s.source} />
                <span style={{ color: "#ccc", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                <span style={{ color: "var(--text-on-surface-subtle)", fontSize: 10, flexShrink: 0 }}>{timeAgo(s.started_at)}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center" }}>
                <span style={{ color: "#4f4", fontSize: 10 }}>{fmtCost(s.cost_usd)}</span>
                <span style={{ color: s.cache_hit_rate > 0.7 ? "#4f4" : "var(--text-on-surface-dim)", fontSize: 10 }}>{fmtPct(s.cache_hit_rate)} cache</span>
                {s.tags.map((t) => (
                  <span key={t} style={{ background: "#1a2a1a", border: "1px solid #3a5a3a", color: "#6f6", borderRadius: 3, fontSize: 9, padding: "1px 5px" }}>{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Compare view ───────────────────────────────────────────────────

interface CompareViewProps {
  initialA?: string
  initialB?: string
  onBack: () => void
  onSelectSession: (id: string) => void
}

function CompareView({ initialA, initialB, onBack, onSelectSession }: CompareViewProps) {
  const [idA, setIdA] = useState(initialA ?? "")
  const [idB, setIdB] = useState(initialB ?? "")
  const [comparison, setComparison] = useState<WireSessionComparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allSessions, setAllSessions] = useState<WireSessionSummary[]>([])
  const [copiedSid, setCopiedSid] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/sessions?limit=200")
      .then((r) => r.json())
      .then((d) => setAllSessions(d as WireSessionSummary[]))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (idA && idB) runCompare()
  }, [idA, idB]) // eslint-disable-line react-hooks/exhaustive-deps

  const runCompare = async () => {
    if (!idA.trim() || !idB.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/compare?a=${encodeURIComponent(idA.trim())}&b=${encodeURIComponent(idB.trim())}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setComparison(await res.json() as WireSessionComparison)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const swap = () => {
    const tmp = idA
    setIdA(idB)
    setIdB(tmp)
    setComparison(null)
  }

  // for cost/tokens: negative diff (A < B) = A is better = green
  // for cache_hit_rate: positive delta = A is better = green
  const diffColor = (val: number, lowerIsBetter = true): string => {
    if (val === 0) return "var(--text-on-surface-muted)"
    return (lowerIsBetter ? val < 0 : val > 0) ? "#4f4" : "#f84"
  }

  const Row = ({ label, valA, valB, rawDelta, lowerIsBetter = true }: {
    label: string, valA: string, valB: string, rawDelta: number, lowerIsBetter?: boolean
  }) => {
    const color = diffColor(rawDelta, lowerIsBetter)
    const sign = rawDelta === 0 ? "–" : rawDelta < 0 ? "▼" : "▲"
    return (
      <tr>
        <td style={{ padding: "5px 8px", color: "var(--text-on-surface-muted)", fontSize: 11, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{label}</td>
        <td style={{ padding: "5px 8px", color: "#aaa", fontSize: 11, textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{valA}</td>
        <td style={{ padding: "5px 8px", fontSize: 12, textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.04)", color, fontWeight: "bold" }}>
          {sign}
        </td>
        <td style={{ padding: "5px 8px", color: "var(--text-on-surface-dim)", fontSize: 11, textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{valB}</td>
      </tr>
    )
  }

  const thStyle: React.CSSProperties = { padding: "4px 8px", color: "var(--text-on-surface-subtle)", fontSize: 10, fontWeight: "normal", textAlign: "right" }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "auto" }}>
      {/* header */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{ background: "none", border: "1px solid #333", color: "var(--text-on-surface-dim)", borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          ← back
        </button>
        <span style={{ color: "var(--text-on-surface-dim)", fontSize: 13 }}>Compare Sessions</span>
      </div>

      {/* session pickers */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 0, flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ color: "var(--text-on-surface-subtle)", fontSize: 10 }}>Session A</label>
          <SessionPicker
            value={idA}
            onChange={(id) => { setIdA(id); setComparison(null) }}
            sessions={allSessions}
            placeholder="search session A…"
            exclude={idB}
          />
          {(() => {
            const s = allSessions.find((x) => x.session_id === idA)
            if (!s) return null
            return (
              <div style={{ background: "rgba(0,255,0,0.04)", border: "1px solid rgba(0,255,0,0.15)", borderRadius: 6, padding: "8px 10px", width: 280, boxSizing: "border-box" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <SourceBadge source={s.source} />
                  <span style={{ color: "#4f4", fontSize: 11, fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                  <div style={{ flex: 1 }} />
                  {s.tags.map((t) => (
                    <span key={t} style={{ background: "#1a2a1a", border: "1px solid #3a5a3a", color: "#6f6", borderRadius: 3, fontSize: 9, padding: "1px 5px" }}>{t}</span>
                  ))}
                </div>
                <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10, marginTop: 2 }}>{s.model_name ?? "—"} · {shortCwd(s.cwd)}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                  <span style={{ color: "var(--text-on-surface-subtle)", fontSize: 9, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.session_id}</span>
                  <span
                    onClick={() => { navigator.clipboard.writeText(s.session_id); setCopiedSid("a") }}
                    style={{ cursor: "pointer", color: copiedSid === "a" ? "#4f4" : "var(--text-on-surface-muted)", fontSize: 10, flexShrink: 0 }}
                  >
                    {copiedSid === "a" ? "\u2713" : "\u2398"}
                  </span>
                </div>
                {(() => {
                  const cw = getContextWindow(idA, s.context_window_limit)
                  if (!cw) return null
                  return (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${Math.round(cw.pct * 100)}%`, height: "100%", background: cw.pct > 0.8 ? "#f84" : cw.pct > 0.5 ? "#ff4" : "#4f4", borderRadius: 3 }} />
                        </div>
                        <span style={{ color: "var(--text-on-surface-muted)", fontSize: 9, whiteSpace: "nowrap" }}>
                          {fmtTokens(cw.used)} / {fmtTokens(cw.limit)} ({Math.round(cw.pct * 100)}%)
                        </span>
                      </div>
                      <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 9, marginTop: 1 }}>
                        lifetime: {fmtTokens(s.input_tokens)} in / {fmtTokens(s.output_tokens)} out
                        · ctx: {fmtTokens(cw.used)}
                      </div>
                    </>
                  )
                })()}
                <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-on-surface-muted)", fontSize: 10 }}>{fmtTokens(s.input_tokens)} in</span>
                  <span style={{ color: "var(--text-on-surface-muted)", fontSize: 10 }}>{fmtTokens(s.output_tokens)} out</span>
                  <span style={{ color: s.cache_hit_rate > 0.7 ? "#4f4" : "var(--text-on-surface-dim)", fontSize: 10 }}>{fmtPct(s.cache_hit_rate)} cache</span>
                  <span style={{ color: "var(--text-on-surface-muted)", fontSize: 10 }}>{s.tool_call_count} tools</span>
                  <span style={{ color: "var(--text-on-surface-muted)", fontSize: 10 }}>{fmtDuration(s.active_ms)}</span>
                  <span style={{ color: "#4f4", fontSize: 10 }}>{fmtCost(s.cost_usd)}</span>
                </div>
              </div>
            )
          })()}
        </div>
        <button
          onClick={swap}
          style={{ background: "none", border: "1px solid #333", color: "var(--text-on-surface-muted)", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12, marginBottom: 2 }}
          title="swap A and B"
        >
          ⇄
        </button>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ color: "var(--text-on-surface-subtle)", fontSize: 10 }}>Session B</label>
          <SessionPicker
            value={idB}
            onChange={(id) => { setIdB(id); setComparison(null) }}
            sessions={allSessions}
            placeholder="search session B…"
            exclude={idA}
          />
          {(() => {
            const s = allSessions.find((x) => x.session_id === idB)
            if (!s) return null
            return (
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "8px 10px", width: 280, boxSizing: "border-box" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <SourceBadge source={s.source} />
                  <span style={{ color: "var(--text-on-surface-dim)", fontSize: 11, fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                  <div style={{ flex: 1 }} />
                  {s.tags.map((t) => (
                    <span key={t} style={{ background: "#1a2a1a", border: "1px solid #3a5a3a", color: "#6f6", borderRadius: 3, fontSize: 9, padding: "1px 5px" }}>{t}</span>
                  ))}
                </div>
                <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10, marginTop: 2 }}>{s.model_name ?? "—"} · {shortCwd(s.cwd)}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                  <span style={{ color: "var(--text-on-surface-subtle)", fontSize: 9, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.session_id}</span>
                  <span
                    onClick={() => { navigator.clipboard.writeText(s.session_id); setCopiedSid("b") }}
                    style={{ cursor: "pointer", color: copiedSid === "b" ? "#4f4" : "var(--text-on-surface-muted)", fontSize: 10, flexShrink: 0 }}
                  >
                    {copiedSid === "b" ? "\u2713" : "\u2398"}
                  </span>
                </div>
                {(() => {
                  const cw = getContextWindow(idB, s.context_window_limit)
                  if (!cw) return null
                  return (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${Math.round(cw.pct * 100)}%`, height: "100%", background: cw.pct > 0.8 ? "#f84" : cw.pct > 0.5 ? "#ff4" : "#4f4", borderRadius: 3 }} />
                        </div>
                        <span style={{ color: "var(--text-on-surface-muted)", fontSize: 9, whiteSpace: "nowrap" }}>
                          {fmtTokens(cw.used)} / {fmtTokens(cw.limit)} ({Math.round(cw.pct * 100)}%)
                        </span>
                      </div>
                      <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 9, marginTop: 1 }}>
                        lifetime: {fmtTokens(s.input_tokens)} in / {fmtTokens(s.output_tokens)} out
                        · ctx: {fmtTokens(cw.used)}
                      </div>
                    </>
                  )
                })()}
                <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-on-surface-muted)", fontSize: 10 }}>{fmtTokens(s.input_tokens)} in</span>
                  <span style={{ color: "var(--text-on-surface-muted)", fontSize: 10 }}>{fmtTokens(s.output_tokens)} out</span>
                  <span style={{ color: s.cache_hit_rate > 0.7 ? "#4f4" : "var(--text-on-surface-dim)", fontSize: 10 }}>{fmtPct(s.cache_hit_rate)} cache</span>
                  <span style={{ color: "var(--text-on-surface-muted)", fontSize: 10 }}>{s.tool_call_count} tools</span>
                  <span style={{ color: "var(--text-on-surface-muted)", fontSize: 10 }}>{fmtDuration(s.active_ms)}</span>
                  <span style={{ color: "var(--text-on-surface-dim)", fontSize: 10 }}>{fmtCost(s.cost_usd)}</span>
                </div>
              </div>
            )
          })()}
        </div>
        <button
          onClick={runCompare}
          disabled={!idA || !idB || loading}
          style={{ background: "#1a3a1a", border: "1px solid #4f4", color: "#4f4", borderRadius: 4, padding: "4px 16px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11, opacity: (!idA || !idB) ? 0.5 : 1, marginBottom: 2 }}
        >
          {loading ? "…" : "↻ Compare"}
        </button>
      </div>

      {error && <div style={{ color: "#f84", fontSize: 11, marginBottom: 12 }}>{error}</div>}

      {comparison && (
        <div style={{ flexShrink: 0 }}>
          {/* labels */}
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 32px 1fr", gap: 0, marginBottom: 8 }}>
            <div />
            <div style={{ textAlign: "right", padding: "0 8px" }}>
              <div style={{ color: "#4f4", fontSize: 11, fontWeight: "bold" }}>{comparison.a.label}</div>
              <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10 }}>{timeAgo(comparison.a.started_at)}</div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 2 }}>
                {comparison.a.tags.map((t) => (
                  <span key={t} style={{ background: "#1a2a1a", border: "1px solid #3a5a3a", color: "#6f6", borderRadius: 3, fontSize: 9, padding: "1px 5px" }}>{t}</span>
                ))}
              </div>
            </div>
            <div />
            <div style={{ textAlign: "right", padding: "0 8px" }}>
              <div style={{ color: "var(--text-on-surface-dim)", fontSize: 11, fontWeight: "bold" }}>{comparison.b.label}</div>
              <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10 }}>{timeAgo(comparison.b.started_at)}</div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 2 }}>
                {comparison.b.tags.map((t) => (
                  <span key={t} style={{ background: "#1a2a1a", border: "1px solid #3a5a3a", color: "#6f6", borderRadius: 3, fontSize: 9, padding: "1px 5px" }}>{t}</span>
                ))}
              </div>
            </div>
          </div>

          {/* context hero cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {[comparison.a, comparison.b].map((sess, i) => {
              const cw = getContextWindow(sess.session_id, sess.context_window_limit)
              return (
                <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: 12, textAlign: "center" }}>
                  <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10, marginBottom: 4 }}>Context {i === 0 ? "(A)" : "(B)"}</div>
                  <div style={{
                    fontSize: 28,
                    fontWeight: "bold",
                    color: cw ? "#4f4" : sess.cache_hit_rate > 0.7 ? "#4f4" : sess.cache_hit_rate > 0.4 ? "#ff4" : "#f84",
                  }}>
                    {cw ? fmtTokens(cw.used) : fmtPct(sess.cache_hit_rate)}
                  </div>
                  <div style={{ color: "var(--text-on-surface-subtle)", fontSize: 10, marginTop: 2 }}>
                    {cw
                      ? `${fmtTokens(cw.used)} / ${fmtTokens(cw.limit)} (${Math.round(cw.pct * 100)}%)`
                      : `${fmtTokens(sess.cache_read_tokens)} cached / ${fmtTokens(sess.input_tokens + sess.cache_read_tokens)} total input`
                    }
                  </div>
                  <div style={{ color: "#444", fontSize: 10, marginTop: 8 }}>
                    {cw ? (
                      <span style={{ color: "#4f4" }}>{fmtPct(sess.cache_hit_rate)} cache hit rate</span>
                    ) : i === 0 && comparison.diff.cache_hit_rate_delta !== 0 ? (
                      <span style={{ color: comparison.diff.cache_hit_rate_delta > 0 ? "#4f4" : "#f84" }}>
                        {comparison.diff.cache_hit_rate_delta > 0 ? "+" : ""}{Math.round(comparison.diff.cache_hit_rate_delta * 100)}pp vs B
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          {/* comparison table */}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: "left", width: 180 }}>Metric</th>
                <th style={{ ...thStyle, color: "#4f4" }}>A</th>
                <th style={{ ...thStyle, textAlign: "center", width: 32 }}></th>
                <th style={{ ...thStyle }}>B</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Input tokens" valA={fmtTokens(comparison.a.input_tokens)} valB={fmtTokens(comparison.b.input_tokens)} rawDelta={comparison.diff.input_tokens} />
              <Row label="Output tokens" valA={fmtTokens(comparison.a.output_tokens)} valB={fmtTokens(comparison.b.output_tokens)} rawDelta={comparison.diff.output_tokens} />
              <Row label="Cache reads" valA={fmtTokens(comparison.a.cache_read_tokens)} valB={fmtTokens(comparison.b.cache_read_tokens)} rawDelta={comparison.diff.cache_read_tokens} lowerIsBetter={false} />
              <Row label="Tool calls" valA={String(comparison.a.tool_call_count)} valB={String(comparison.b.tool_call_count)} rawDelta={comparison.diff.tool_call_count} />
              <Row label="Active time" valA={fmtDuration(comparison.a.active_ms)} valB={fmtDuration(comparison.b.active_ms)} rawDelta={comparison.diff.active_ms} />
              {(() => {
                const cwA = getContextWindow(comparison.a.session_id, comparison.a.context_window_limit)
                const cwB = getContextWindow(comparison.b.session_id, comparison.b.context_window_limit)
                if (!cwA || !cwB) return null
                const delta = cwA.pct - cwB.pct
                return (
                  <tr>
                    <td style={{ padding: "5px 8px", color: "var(--text-on-surface-muted)", fontSize: 11, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>Context window</td>
                    <td style={{ padding: "5px 8px", color: "#aaa", fontSize: 11, textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      {fmtTokens(cwA.used)} / {fmtTokens(cwA.limit)} ({Math.round(cwA.pct * 100)}%)
                    </td>
                    <td style={{ padding: "5px 8px", fontSize: 12, textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.04)", color: delta === 0 ? "var(--text-on-surface-muted)" : "#ff4", fontWeight: "bold" }}>
                      {delta === 0 ? "–" : delta < 0 ? "▼" : "▲"}
                    </td>
                    <td style={{ padding: "5px 8px", color: "var(--text-on-surface-dim)", fontSize: 11, textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      {fmtTokens(cwB.used)} / {fmtTokens(cwB.limit)} ({Math.round(cwB.pct * 100)}%)
                    </td>
                  </tr>
                )
              })()}
              <tr><td colSpan={4} style={{ height: 8 }} /></tr>
              <Row label="Cost (self)" valA={fmtCost(comparison.a.cost_usd)} valB={fmtCost(comparison.b.cost_usd)} rawDelta={comparison.diff.cost_usd} />
              <Row label="Cost (incl. children)" valA={fmtCost(comparison.a.total_cost_usd)} valB={fmtCost(comparison.b.total_cost_usd)} rawDelta={comparison.diff.total_cost_usd} />
            </tbody>
          </table>

          {/* link to detail */}
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <button
              onClick={() => onSelectSession(comparison.a.session_id)}
              style={{ background: "none", border: "1px solid #333", color: "var(--text-on-surface-muted)", borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10 }}
            >
              view A detail
            </button>
            <button
              onClick={() => onSelectSession(comparison.b.session_id)}
              style={{ background: "none", border: "1px solid #333", color: "var(--text-on-surface-muted)", borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10 }}
            >
              view B detail
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Hash routing ───────────────────────────────────────────────────

type HistoryView =
  | { type: "list" }
  | { type: "detail"; id: string }
  | { type: "compare"; preselectedA?: string; preselectedB?: string }

function parseHashView(): HistoryView {
  const hash = window.location.hash.replace(/^#\/?/, "")
  const parts = hash.split("/").filter(Boolean)
  // parts[0] === "history"
  if (parts[1] === "compare") {
    return {
      type: "compare",
      preselectedA: parts[2] || undefined,
      preselectedB: parts[3] || undefined,
    }
  }
  if (parts[1] && parts[1].length > 8) {
    return { type: "detail", id: parts[1] }
  }
  return { type: "list" }
}

function viewToHash(v: HistoryView): string {
  if (v.type === "detail") return `#/history/${v.id}`
  if (v.type === "compare") {
    if (v.preselectedA && v.preselectedB) return `#/history/compare/${v.preselectedA}/${v.preselectedB}`
    if (v.preselectedA) return `#/history/compare/${v.preselectedA}`
    return "#/history/compare"
  }
  return "#/history"
}

// ── HistoryPage ────────────────────────────────────────────────────

export function HistoryPage() {
  const [view, setView] = useState<HistoryView>(parseHashView)

  const nav = useCallback((v: HistoryView) => {
    setView(v)
    window.location.hash = viewToHash(v)
  }, [])

  useEffect(() => {
    window.location.hash = viewToHash(view)
  }, []) // sync hash on mount

  useEffect(() => {
    const handler = () => setView(parseHashView())
    window.addEventListener("hashchange", handler)
    return () => window.removeEventListener("hashchange", handler)
  }, [])

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {view.type === "list" && (
        <SessionList
          onSelect={(id) => nav({ type: "detail", id })}
          onCompare={(a, b) => nav({ type: "compare", preselectedA: a, preselectedB: b })}
        />
      )}
      {view.type === "detail" && (
        <SessionDetail
          sessionId={view.id}
          onBack={() => nav({ type: "list" })}
          onCompareWith={(id) => nav({ type: "compare", preselectedA: id })}
        />
      )}
      {view.type === "compare" && (
        <CompareView
          initialA={view.preselectedA}
          initialB={view.preselectedB}
          onBack={() => nav({ type: "list" })}
          onSelectSession={(id) => nav({ type: "detail", id })}
        />
      )}
    </div>
  )
}
