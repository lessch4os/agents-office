import { useState, useEffect } from "react"

interface ModelPricingRow {
  model_name: string
  input_per_m: number
  output_per_m: number
  cache_read_per_m: number
  source: string
}

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  default: { label: "default", color: "#4f4" },
  user: { label: "modified", color: "#ff4" },
  auto: { label: "auto", color: "#fa4" },
}

function PricingTable() {
  const [rows, setRows] = useState<ModelPricingRow[]>([])
  const [edits, setEdits] = useState<Record<string, ModelPricingRow>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = () => {
    fetch("/api/pricing")
      .then((r) => r.json())
      .then((data) => {
        setRows(data as ModelPricingRow[])
        setEdits({})
      })
      .catch(() => setMsg("failed to load pricing"))
  }

  useEffect(() => { load() }, [])

  const dirty = (name: string): boolean => {
    const e = edits[name]
    if (!e) return false
    const orig = rows.find((r) => r.model_name === name)
    if (!orig) return true
    return e.input_per_m !== orig.input_per_m ||
      e.output_per_m !== orig.output_per_m ||
      e.cache_read_per_m !== orig.cache_read_per_m
  }

  const save = async (name: string) => {
    const e = edits[name]
    if (!e) return
    setSaving(name)
    setMsg(null)
    try {
      const res = await fetch("/api/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_name: e.model_name,
          input_per_m: e.input_per_m,
          output_per_m: e.output_per_m,
          cache_read_per_m: e.cache_read_per_m,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMsg(`saved ${name}`)
      load()
    } catch (err) {
      setMsg(`error: ${err}`)
    } finally {
      setSaving(null)
    }
  }

  const resetAll = async () => {
    if (!confirm("Reset all pricing to defaults?")) return
    setMsg(null)
    try {
      const res = await fetch("/api/pricing/reset", { method: "POST" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMsg("reset to defaults")
      load()
    } catch (err) {
      setMsg(`error: ${err}`)
    }
  }

  const cellStyle: React.CSSProperties = {
    padding: "5px 8px",
    fontSize: 11,
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    whiteSpace: "nowrap",
  }

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-surface)",
    border: "1px solid #333",
    color: "#ccc",
    borderRadius: 3,
    padding: "2px 4px",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    width: 70,
    textAlign: "right" as const,
    outline: "none",
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexShrink: 0 }}>
        <span style={{ color: "var(--text-on-surface-muted)", fontSize: 11 }}>
          Model pricing · values shown in $ per 1M tokens
        </span>
        <div style={{ flex: 1 }} />
        {msg && (
          <span style={{ color: msg.startsWith("error") ? "#f84" : "#4f4", fontSize: 10 }}>{msg}</span>
        )}
        <button
          onClick={resetAll}
          style={{
            background: "none",
            border: "1px solid #844",
            color: "#f84",
            borderRadius: 4,
            padding: "3px 10px",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          Reset to defaults
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ color: "var(--text-on-surface-subtle)", fontSize: 10 }}>
              <th style={{ ...cellStyle, textAlign: "left" }}>Model</th>
              <th style={{ ...cellStyle, textAlign: "right" }}>Input $/1M</th>
              <th style={{ ...cellStyle, textAlign: "right" }}>Output $/1M</th>
              <th style={{ ...cellStyle, textAlign: "right" }}>Cache $/1M</th>
              <th style={{ ...cellStyle, textAlign: "center" }}>Source</th>
              <th style={{ ...cellStyle, textAlign: "center" }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const e = edits[row.model_name] ?? row
              const isDirty = dirty(row.model_name)
              const src = SOURCE_LABELS[row.source] ?? { label: row.source, color: "#888" }
              return (
                <tr key={row.model_name}
                  style={{ background: isDirty ? "rgba(255,255,80,0.04)" : "transparent" }}
                >
                  <td style={{ ...cellStyle, color: "#ccc", fontFamily: "var(--font-mono)", fontSize: 10 }}>
                    {row.model_name}
                  </td>
                  <td style={cellStyle}>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={String(e.input_per_m)}
                      onChange={(ev) => setEdits({ ...edits, [row.model_name]: { ...e, input_per_m: parseFloat(ev.target.value) || 0 } })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={String(e.output_per_m)}
                      onChange={(ev) => setEdits({ ...edits, [row.model_name]: { ...e, output_per_m: parseFloat(ev.target.value) || 0 } })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={String(e.cache_read_per_m)}
                      onChange={(ev) => setEdits({ ...edits, [row.model_name]: { ...e, cache_read_per_m: parseFloat(ev.target.value) || 0 } })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={{ ...cellStyle, textAlign: "center" }}>
                    <span style={{
                      color: src.color,
                      border: `1px solid ${src.color}`,
                      borderRadius: 3,
                      fontSize: 9,
                      padding: "1px 5px",
                      opacity: 0.8,
                    }}>
                      {src.label}
                    </span>
                  </td>
                  <td style={{ ...cellStyle, textAlign: "center" }}>
                    <button
                      onClick={() => save(row.model_name)}
                      disabled={!isDirty || saving === row.model_name}
                      style={{
                        background: isDirty ? "#2a4a2a" : "none",
                        border: "1px solid",
                        borderColor: isDirty ? "#4f4" : "#333",
                        color: isDirty ? "#4f4" : "var(--text-on-surface-dim)",
                        borderRadius: 4,
                        padding: "2px 10px",
                        cursor: isDirty ? "pointer" : "default",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        opacity: isDirty ? 1 : 0.4,
                      }}
                    >
                      {saving === row.model_name ? "…" : "Save"}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function PricingPage() {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <PricingTable />
    </div>
  )
}
