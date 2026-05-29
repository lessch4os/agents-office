import { useRef, useEffect, useState } from "react"
import type { WireScene, WireAgent, WireLogEntry } from "../types"
import type { Pose } from "./sprites"
import { SPRITES, renderSpriteCentered } from "./sprites"
import {
  drawFloor,
  drawDesk,
  drawGlow,
  drawDelegationLine,
  drawNameplate,
  drawContextBar,
  drawDecorItem,
  drawZoneSign,
  drawSpeechBubble,
  createSpeechBubble,
  deriveBubbleLines,
  drawToolEffects,
  drawParticles,
  tickParticles,
  createParticles,
  drawElevator,
  tickElevator,
  createElevatorState,
  computeZones,
  spawnToolEffect,
} from "./renderer"
import type { Zone, SpeechBubble, Particle, ElevatorState, DeskVariant } from "./renderer"
import { setLiveAgentsCache } from "../liveAgentsCache"

const DESK_W = 80
const DESK_H = 44
const DESK_GAP = 20
const COLS = 4
const SPRITE_SCALE = 2

const TOOL_COLORS: Record<string, [number, number, number]> = {
  Bash: [255, 136, 68],
  Read: [136, 68, 255],
  Write: [68, 255, 68],
  Edit: [68, 136, 255],
  MultiEdit: [68, 136, 255],
  Glob: [255, 68, 255],
  Grep: [255, 68, 255],
  Agent: [255, 255, 68],
  Task: [255, 255, 68],
}

const STATE_COLORS: Record<string, [number, number, number]> = {
  Idle: [136, 136, 136],
  Active: [68, 255, 68],
  Waiting: [255, 255, 68],
}

const DECO_KINDS = ["plant", "water", "server"] as const

function deskCoord(index: number): [number, number] {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  return [40 + col * (DESK_W + DESK_GAP), 40 + row * (DESK_H + DESK_GAP)]
}

function centerOf(index: number): [number, number] {
  const [x, y] = deskCoord(index)
  return [x + DESK_W / 2, y + DESK_H / 2 - 4]
}

function hashTint(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  const palette = [
    "rgba(68,255,68,0.06)",
    "rgba(68,136,255,0.06)",
    "rgba(255,136,68,0.06)",
    "rgba(136,68,255,0.06)",
    "rgba(255,68,136,0.06)",
    "rgba(68,255,255,0.06)",
    "rgba(255,255,68,0.06)",
    "rgba(255,68,68,0.06)",
  ]
  return palette[Math.abs(h) % palette.length]
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

function poseForAgent(agent: WireAgent): Pose {
  if (agent.state.type === "Active") {
    const activity = agent.state.activity
    if (activity === "reading") return "reading"
    if (activity === "thinking") return "thinking"
    return "active"
  }
  if (agent.state.type === "Waiting") return "waiting"
  return "idle"
}

function spriteColor(agent: WireAgent): [number, number, number] {
  if (agent.state.type === "Active" && agent.current_tool) {
    const tc = TOOL_COLORS[agent.current_tool]
    if (tc) {
      const [ar, ag, ab] = STATE_COLORS.Active
      return [
        Math.round(tc[0] * 0.7 + ar * 0.3),
        Math.round(tc[1] * 0.7 + ag * 0.3),
        Math.round(tc[2] * 0.7 + ab * 0.3),
      ]
    }
  }
  return STATE_COLORS[agent.state.type] ?? STATE_COLORS.Idle
}

function bobOffset(type: string, t: number, seed: number, activity?: string): number {
  const phase = seed * 2.3
  if (type === "Active") {
    if (activity === "reading") return Math.sin(t * 0.008 + phase) * 1.5
    if (activity === "thinking") return Math.sin(t * 0.0015 + phase) * 2.5
    return Math.sin(t * 0.006 + phase) * 2
  }
  if (type === "Waiting") return Math.sin(t * 0.002 + phase) * 1
  return Math.sin(t * 0.003 + phase) * 1.5
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false })
}

function deskVariant(toolCallCount: number): DeskVariant {
  if (toolCallCount > 100) return "cluttered"
  if (toolCallCount > 50) return "wide"
  if (toolCallCount > 20) return "corner"
  return "standard"
}

type DecorSpot = { kind: string; x: number; y: number; w: number; h: number }

function computeDecorSpots(rows: number): DecorSpot[] {
  const spots: DecorSpot[] = []
  for (let r = 0; r < rows; r++) {
    const dk = DECO_KINDS[r % DECO_KINDS.length]
    const lastX = 40 + (COLS - 1) * (DESK_W + DESK_GAP)
    spots.push({
      kind: dk,
      x: lastX + DESK_W + 14,
      y: 40 + r * (DESK_H + DESK_GAP) + 8,
      w: 20,
      h: 20,
    })
  }
  if (rows > 0) {
    const dk = DECO_KINDS[rows % DECO_KINDS.length]
    const lastRowY = 40 + (rows - 1) * (DESK_H + DESK_GAP)
    spots.push({
      kind: dk,
      x: 50,
      y: lastRowY + DESK_H + 28,
      w: 20,
      h: 20,
    })
  }
  return spots
}

type Props = { scene: WireScene | null; logEntries?: WireLogEntry[] }

export function Office({ scene, logEntries }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<WireScene | null>(null)
  sceneRef.current = scene

  const prevToolsRef = useRef<Map<number, string | null>>(new Map())
  const decorRef = useRef<DecorSpot[]>([])
  const zonesRef = useRef<Zone[]>([])
  const bubblesRef = useRef<Map<number, SpeechBubble>>(new Map())
  const floorParticlesRef = useRef<Particle[]>([])
  const airParticlesRef = useRef<Particle[]>([])
  const elevatorRef = useRef<ElevatorState>(createElevatorState())
  const prevAgentMapRef = useRef<Map<number, WireAgent>>(new Map())
  const lastFrameRef = useRef(0)

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; agent: WireAgent } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<WireAgent | null>(null)
  const [modalTab, setModalTab] = useState<"overview" | "logs" | "stats" | "tree">("overview")

  useEffect(() => {
    if (!selectedAgent) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedAgent(null)
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [selectedAgent])

  const maxDesks = scene?.max_desks ?? 16
  const rows = Math.ceil(maxDesks / COLS)
  const extraW = 60
  const canvasW = COLS * (DESK_W + DESK_GAP) + 80 + 40 + extraW
  const canvasH = rows * (DESK_H + DESK_GAP) + 80

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = () => setContextMenu(null)
    document.addEventListener("click", dismiss)
    return () => document.removeEventListener("click", dismiss)
  }, [contextMenu])

  // ── Init particles on mount ──
  useEffect(() => {
    floorParticlesRef.current = createParticles(30, canvasW, canvasH, 0.3)
    airParticlesRef.current = createParticles(20, canvasW, canvasH, 0.15)
  }, [canvasW, canvasH])

  // ── Compute zones when scene changes ──
  useEffect(() => {
    if (!scene) {
      zonesRef.current = []
      return
    }
    const agents = Object.values(scene.agents).map((a) => ({
      desk_index: a.desk_index,
      source: a.source,
    }))
    zonesRef.current = computeZones(agents, COLS, DESK_W, DESK_H, DESK_GAP, 40)
  }, [scene])

  // ── Main RAF loop ──
  useEffect(() => {
    let running = true
    let rafId = 0

    function draw(t: number) {
      if (!running) return

      const dt = lastFrameRef.current ? (t - lastFrameRef.current) / 1000 : 0.016
      lastFrameRef.current = t

      const cvs = canvasRef.current
      if (!cvs) { rafId = requestAnimationFrame(draw); return }
      const ctx = cvs.getContext("2d")
      if (!ctx) { rafId = requestAnimationFrame(draw); return }

      const s = sceneRef.current

      ctx.clearRect(0, 0, cvs.width, cvs.height)

      // ── Layer 0: background ──
      ctx.fillStyle = "#0f0f1a"
      ctx.fillRect(0, 0, cvs.width, cvs.height)

      if (!s) {
        ctx.fillStyle = "#666"
        ctx.font = "14px monospace"
        ctx.textAlign = "center"
        ctx.fillText("awaiting agents\u2026", cvs.width / 2, cvs.height / 2)
        rafId = requestAnimationFrame(draw)
        return
      }

      const agents = Object.values(s.agents)
      const deskMap = new Map(agents.map((a) => [a.desk_index, a]))

      // pre-compute decorations
      if (decorRef.current.length === 0) {
        decorRef.current = computeDecorSpots(rows)
      }

      const now = s.now_ms

      // ── Layer 1: floor ──
      drawFloor(ctx, cvs.width, cvs.height)

      // ── Layer 2: zone signage ──
      const zones = zonesRef.current
      for (const zone of zones) {
        drawZoneSign(ctx, zone)
      }

      // ── Layer 3: session grouping tints ──
      const sessionGroups = new Map<string, WireAgent[]>()
      for (const a of agents) {
        const list = sessionGroups.get(a.session_id) ?? []
        list.push(a)
        sessionGroups.set(a.session_id, list)
      }
      for (const [, group] of sessionGroups) {
        if (group.length < 2) continue
        const tint = hashTint(group[0].session_id)
        for (const a of group) {
          const [x, y] = deskCoord(a.desk_index)
          ctx.fillStyle = tint
          ctx.fillRect(x, y, DESK_W, DESK_H)
        }
      }

      // ── Layer 4: floor particles ──
      tickParticles(floorParticlesRef.current, dt, cvs.width, cvs.height)
      drawParticles(ctx, floorParticlesRef.current)

      // ── Layer 5: desks ──
      for (let i = 0; i < maxDesks; i++) {
        const agent = deskMap.get(i)
        const [x, y] = deskCoord(i)
        const occupied_ = agent != null
        const exiting = agent?.exiting_at_ms != null
        const hasMonitorFlash = agent?.state.type === "Active"
        const tint = agent ? hashTint(agent.session_id) : null

        drawDesk(ctx, x, y, DESK_W, DESK_H, {
          occupied: occupied_,
          exiting,
          hasMonitorFlash,
          tint: agent && (sessionGroups.get(agent.session_id)!.length >= 2) ? tint : null,
          variant: agent ? deskVariant(agent.tool_call_count) : "standard",
          toolCallCount: agent?.tool_call_count ?? 0,
        })

        // subagent badge
        if (agent?.agent_type) {
          ctx.fillStyle = "rgba(255,255,255,0.15)"
          ctx.font = "7px monospace"
          ctx.textAlign = "left"
          ctx.textBaseline = "top"
          ctx.fillText("\u25C6", x + 4, y + 4)
        }
      }

      // ── Layer 6: decorations ──
      for (const spot of decorRef.current) {
        drawDecorItem(ctx, spot.kind, spot.x, spot.y, spot.w, spot.h)
      }

      // ── Layer 7: elevator ──
      const elevator = elevatorRef.current
      tickElevator(elevator, dt)
      const shaftX = cvs.width - 48
      drawElevator(ctx, elevator, shaftX, cvs.height)

      // ── Layer 8: delegation lines ──
      for (const a of agents) {
        if (a.parent_id == null) continue
        const parent = deskMap.get(
          agents.find((p) => p.agent_id === a.parent_id)?.desk_index ?? -1,
        )
        if (!parent) continue
        const [x1, y1] = centerOf(parent.desk_index)
        const [x2, y2] = centerOf(a.desk_index)
        drawDelegationLine(ctx, x1, y1, x2, y2, -t * 0.03)
      }

      // ── Layer 9: agent sprites + glows ──
      const currentAgents = new Map(agents.map((a) => [a.agent_id, a]))
      const currentTools = new Map<number, string | null>()

      for (const a of agents) {
        currentTools.set(a.agent_id, a.current_tool)
        const prevTool = prevToolsRef.current.get(a.agent_id)
        if (prevTool !== a.current_tool && a.current_tool != null && a.state.type === "Active") {
          const [cx, cy] = centerOf(a.desk_index)
          const tcol = TOOL_COLORS[a.current_tool] ?? [68, 255, 68]
          spawnToolEffect(cx, cy, tcol)
        }
      }
      prevToolsRef.current = currentTools

      const seedMap = new Map<number, number>()
      agents.forEach((a, i) => seedMap.set(a.agent_id, i))

      for (const a of agents) {
        const [cx, cy] = centerOf(a.desk_index)
        const exiting = a.exiting_at_ms != null
        const elapsed = exiting ? now - (a.exiting_at_ms ?? 0) : 0
        const exitScale = exiting ? Math.max(0.1, 1 - elapsed / 4500) : 1
        const stateType = a.state.type
        const color = spriteColor(a)
        const [cr, cg, cb] = color
        const pose = poseForAgent(a)
        const seed = seedMap.get(a.agent_id) ?? 0
        const activity = stateType === "Active" ? (a.state as { activity: string }).activity : undefined

        // glow
        if (!exiting && stateType !== "Idle") {
          const pulse = stateType === "Active"
            ? 0.5 + 0.5 * Math.sin(t * 0.005)
            : 0.3 + 0.3 * Math.sin(t * 0.002)
          drawGlow(ctx, cx, cy, pulse, color, true)
        }

        // sprite with bob
        if (!exiting) {
          const bob = bobOffset(stateType, t, seed, activity)
          ctx.save()
          ctx.translate(cx, cy + bob)
          ctx.scale(exitScale, exitScale)
          renderSpriteCentered(ctx, SPRITES[pose], 0, 0, SPRITE_SCALE, cr, cg, cb)
          ctx.restore()
        } else {
          ctx.save()
          ctx.translate(cx, cy)
          ctx.scale(exitScale, exitScale)
          renderSpriteCentered(ctx, SPRITES[pose], 0, 0, SPRITE_SCALE, cr, cg, cb)
          ctx.restore()
        }

        // tool detail text above desk
        if (stateType === "Active" && a.state.detail) {
          const dy = deskCoord(a.desk_index)[1]
          ctx.fillStyle = "rgba(255,255,255,0.85)"
          ctx.font = "9px monospace"
          ctx.textAlign = "center"
          ctx.textBaseline = "bottom"
          const display =
            a.state.detail.length > 28
              ? a.state.detail.slice(0, 28) + "\u2026"
              : a.state.detail
          ctx.fillText(display, cx, dy + 2)
        }
      }

      // ── Layer 10: speech bubbles ──
      // detect state changes and upsert bubbles
      const prevAgents = prevAgentMapRef.current
      for (const a of agents) {
        const prev = prevAgents.get(a.agent_id)
        const stateChanged =
          !prev ||
          prev.state.type !== a.state.type ||
          prev.current_tool !== a.current_tool
        if (stateChanged && a.state.type !== "Idle") {
          const [cx, cy] = centerOf(a.desk_index)
          const detail = a.state.type === "Active" ? a.state.detail : null
          const reason = a.state.type === "Waiting" ? (a.state as { reason?: string }).reason : undefined
          const lines = deriveBubbleLines(a.state.type, a.current_tool, detail, reason)
          if (lines.length > 0) {
            bubblesRef.current.set(
              a.agent_id,
              createSpeechBubble(a.agent_id, lines, cx, cy - 8, now),
            )
          }
        }
      }
      // remove bubbles for agents that no longer exist
      for (const [id] of bubblesRef.current) {
        if (!currentAgents.has(id)) bubblesRef.current.delete(id)
      }
      prevAgentMapRef.current = currentAgents

      // draw bubbles (oldest first so newer ones render on top)
      const sortedBubbles = [...bubblesRef.current.values()].sort(
        (a, b) => a.createdAt - b.createdAt,
      )
      for (const bubble of sortedBubbles) {
        const a = currentAgents.get(bubble.agentId)
        if (a) {
          const [cx, cy] = centerOf(a.desk_index)
          bubble.cx = cx
          bubble.cy = cy - 8
        }
        drawSpeechBubble(ctx, bubble, now)
      }
      // cull expired
      for (const [id, bubble] of bubblesRef.current) {
        if (now - bubble.createdAt > bubble.duration) {
          bubblesRef.current.delete(id)
        }
      }

      // ── Layer 11: tool effects (ripples + spark bursts) ──
      drawToolEffects(ctx, t)

      // ── Layer 12: air particles ──
      tickParticles(airParticlesRef.current, dt, cvs.width, cvs.height)
      drawParticles(ctx, airParticlesRef.current)

      // ── Layer 13: nameplates ──
      for (const a of agents) {
        const [cx, cy] = centerOf(a.desk_index)
        const exiting_ = a.exiting_at_ms != null
        const labelY = cy + 18
        drawNameplate(ctx, cx, labelY, a.label, a.tool_call_count, exiting_)

        if (!exiting_) {
          drawContextBar(ctx, cx, labelY + 20, a.context_total_tokens > 0 ? a.context_total_tokens : a.context_input_tokens, a.token_output_total, a.context_window_limit)
        }
      }

      // ── Layer 14: stats ──
      ctx.fillStyle = "#999"
      ctx.font = "11px monospace"
      ctx.textAlign = "left"
      ctx.textBaseline = "bottom"
      ctx.fillText(`agents: ${agents.length}/${maxDesks}`, 10, cvs.height - 8)

      rafId = requestAnimationFrame(draw)
    }

    rafId = requestAnimationFrame(draw)
    return () => {
      running = false
      cancelAnimationFrame(rafId)
    }
  }, [maxDesks, rows]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Desk-grid hit detection ──
  function deskIndexAtPoint(mx: number, my: number): number | null {
    const col = Math.floor((mx - 40) / (DESK_W + DESK_GAP))
    const row = Math.floor((my - 40) / (DESK_H + DESK_GAP))
    const idx = row * COLS + col
    if (col < 0 || col >= COLS || row < 0 || row >= rows || idx >= maxDesks) return null
    return idx
  }

  function findAgentAtPoint(mx: number, my: number): WireAgent | null {
    const s = sceneRef.current
    if (!s) return null
    const deskIdx = deskIndexAtPoint(mx, my)
    if (deskIdx !== null) {
      for (const a of Object.values(s.agents)) {
        if (a.desk_index === deskIdx) return a
      }
    }
    return null
  }

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const s = sceneRef.current
    if (!s || !canvasRef.current) {
      setContextMenu(null)
      return
    }
    const rect = canvasRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const found = findAgentAtPoint(mx, my)
    if (found) {
      setContextMenu({ x: e.clientX, y: e.clientY, agent: found })
    }
  }

  const copyState = (agent: WireAgent) => {
    const data = { ...agent, observed_at_ms: sceneRef.current?.now_ms ?? 0 }
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    setContextMenu(null)
  }

  const copyId = (agent: WireAgent) => {
    navigator.clipboard.writeText(agent.session_id)
    setCopiedId(agent.agent_id.toString())
    setContextMenu(null)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const inspectAgent = (agent: WireAgent) => {
    setContextMenu(null)
    setSelectedAgent(agent)
  }

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        onContextMenu={handleContextMenu}
        style={{ display: "block", margin: "0 auto", borderRadius: 8, cursor: "pointer" }}
      />
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 10001,
            background: "rgba(20,20,40,0.95)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 8,
            padding: "4px 0",
            fontFamily: "monospace",
            fontSize: 12,
            color: "#ccc",
            pointerEvents: "auto",
            minWidth: 160,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <div
            onClick={(e) => {
              e.stopPropagation()
              inspectAgent(contextMenu.agent)
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            style={{
              padding: "8px 14px",
              cursor: "pointer",
              color: "#4f4",
              transition: "background 0.1s",
            }}
          >
            Inspect
          </div>
          <div
            onClick={(e) => {
              e.stopPropagation()
              copyState(contextMenu.agent)
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            style={{
              padding: "8px 14px",
              cursor: "pointer",
              color: "#888",
              transition: "background 0.1s",
            }}
          >
            Copy State
          </div>
          <div
            onClick={(e) => {
              e.stopPropagation()
              copyId(contextMenu.agent)
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            style={{
              padding: "8px 14px",
              cursor: "pointer",
              color: copiedId === contextMenu.agent.agent_id.toString() ? "#4f4" : "#888",
              transition: "background 0.1s, color 0.2s",
            }}
          >
            {copiedId === contextMenu.agent.agent_id.toString() ? "Copied!" : "Copy ID"}
          </div>
          <div
            onClick={(e) => {
              e.stopPropagation()
              setContextMenu(null)
              const ag = contextMenu.agent
              sessionStorage.setItem("compare_agent_a", JSON.stringify(ag))
              setLiveAgentsCache(Object.values(sceneRef.current?.agents ?? []))
              window.location.hash = `#/history/compare/${ag.session_id}`
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            style={{ padding: "8px 14px", cursor: "pointer", color: "#4f4", transition: "background 0.1s" }}
          >
            Compare
          </div>
        </div>
      )}
      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          logEntries={logEntries ?? []}
          allAgents={scene ? Object.values(scene.agents) : []}
          tab={modalTab}
          onTabChange={setModalTab}
          onClose={() => setSelectedAgent(null)}
          fmtTokens={fmtTokens}
          nowMs={scene?.now_ms ?? Date.now()}
        />
      )}
    </div>
  )
}

// ── Agent Detail Modal ────────────────────────────────────────────

const LOG_TYPE_COLORS: Record<string, string> = {
  tool_start: "#4f4",
  tool_result: "#888",
  waiting: "#ff4",
  thought: "#48f",
  error: "#f44",
}

const TAB_LABELS: Array<{ key: "overview" | "logs" | "stats" | "tree"; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "logs", label: "Logs" },
  { key: "stats", label: "Stats" },
  { key: "tree", label: "Session Tree" },
]

const PRICE_INPUT = 3 / 1_000_000
const PRICE_OUTPUT = 15 / 1_000_000
const PRICE_CACHE = 0.3 / 1_000_000

export function AgentDetailModal({
  agent,
  logEntries,
  allAgents,
  tab,
  onTabChange,
  onClose,
  fmtTokens: ft,
  nowMs,
}: {
  agent: WireAgent
  logEntries: WireLogEntry[]
  allAgents: WireAgent[]
  tab: "overview" | "logs" | "stats" | "tree"
  onTabChange: (t: "overview" | "logs" | "stats" | "tree") => void
  onClose: () => void
  fmtTokens: (n: number) => string
  nowMs: number
}) {
  const agentLogs = logEntries.filter((e) => e.agent_id === agent.agent_id)
  const children = allAgents.filter((a) => a.parent_id === agent.agent_id)
  const parent = allAgents.find((a) => a.agent_id === agent.parent_id)
  const [copied, setCopied] = useState<"state" | "sid" | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState("")
  const [toolFilter, setToolFilter] = useState<string | null>(null)

  const copyToClipboard = (type: "state" | "sid") => {
    const text = type === "state" ? JSON.stringify(agent, null, 2) : agent.session_id
    navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(null), 1500)
  }

  useEffect(() => {
    fetch(`/api/sessions/${agent.session_id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d && Array.isArray(d.tags)) setTags(d.tags as string[]) })
      .catch(() => {})
  }, [agent.session_id])

  const addTag = () => {
    const t = newTag.trim()
    if (!t || tags.includes(t)) return
    setTags((prev) => [...prev, t])
    setNewTag("")
    fetch(`/api/sessions/${agent.session_id}/tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: t }),
    }).catch(() => {})
  }

  const removeTag = (t: string) => {
    setTags((prev) => prev.filter((x) => x !== t))
    fetch(`/api/sessions/${agent.session_id}/tag/${encodeURIComponent(t)}`, { method: "DELETE" }).catch(() => {})
  }

  return (
    <div
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: "var(--z-modal)",
        background: "var(--bg-surface-elevated)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid var(--border-hover)",
        borderRadius: 12,
        padding: 0,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--text-on-surface)",
        minWidth: 460,
        maxWidth: 640,
        maxHeight: "80vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--shadow-modal)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "14px 16px 0 16px", flexShrink: 0,
      }}>
        <div>
          <span style={{
            color: agent.state.type === "Active" ? "#4f4" : "#888",
            fontWeight: "bold", fontSize: 14,
          }}>
            {agent.label}
          </span>
          {agent.agent_type && (
            <span style={{ color: "#888", marginLeft: 8, fontSize: 10 }}>
              [{agent.agent_type}]
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => copyToClipboard("state")}
            title="Copy agent state to clipboard"
            style={{
              background: "none", border: "1px solid #444",
              color: copied === "state" ? "#4f4" : "#888",
              borderRadius: 4, padding: "2px 8px", cursor: "pointer",
              fontFamily: "monospace", fontSize: 11,
              transition: "color 0.15s",
            }}
          >
            {copied === "state" ? "✓" : "CC"}
          </button>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "1px solid #444", color: "#888",
              borderRadius: 4, padding: "2px 10px", cursor: "pointer",
              fontFamily: "monospace", fontSize: 12,
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* tabs */}
      <div style={{
        display: "flex", gap: 0, marginTop: 12, borderBottom: "1px solid rgba(255,255,255,0.08)",
        padding: "0 12px", flexShrink: 0,
      }}>
        {TAB_LABELS.map((t) => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            style={{
              background: "none",
              border: "none",
              borderBottom: tab === t.key ? "2px solid #4f4" : "2px solid transparent",
              color: tab === t.key ? "#4f4" : "#666",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 11,
              padding: "6px 14px",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* content */}
      <div style={{ flex: 1, overflow: "auto", padding: 16, minHeight: 200 }}>
        {tab === "overview" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <div>
                <div style={{ color: "#555", fontSize: 10 }}>Source</div>
                <div style={{ color: "#aaa" }}>{agent.source}</div>
              </div>
              <div>
                <div style={{ color: "#555", fontSize: 10 }}>Tools</div>
                <div style={{ color: "#aaa" }}>{agent.tool_call_count}</div>
              </div>
              <div>
                <div style={{ color: "#555", fontSize: 10 }}>Active Time</div>
                <div style={{ color: "#aaa" }}>{Math.round(agent.active_ms / 1000)}s</div>
              </div>
              <div>
                <div style={{ color: "#555", fontSize: 10 }}>Desk</div>
                <div style={{ color: "#aaa" }}>#{agent.desk_index}</div>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "#555", fontSize: 10 }}>CWD</div>
              <div style={{ color: "#888", wordBreak: "break-all" }}>{agent.cwd}</div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "#555", fontSize: 10 }}>Session ID</div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <div style={{ color: "#666", fontSize: 10, wordBreak: "break-all", flex: 1 }}>{agent.session_id}</div>
                <button
                  onClick={() => copyToClipboard("sid")}
                  title="Copy session ID"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: copied === "sid" ? "#4f4" : "#555",
                    fontSize: 13, padding: "0 2px", flexShrink: 0, lineHeight: 1,
                    transition: "color 0.15s",
                  }}
                >
                  {copied === "sid" ? "✓" : "⎘"}
                </button>
              </div>
            </div>

            {agent.state.type !== "Idle" && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: "#555", fontSize: 10 }}>Status</div>
                <div style={{
                  color: agent.state.type === "Waiting" ? "#ff4" : "#4f4",
                  marginTop: 2,
                }}>
                  {agent.state.type === "Waiting"
                    ? `⏳ ${agent.state.reason}`
                    : (agent.state.detail ?? agent.state.activity ?? "working…")}
                </div>
              </div>
            )}

            {agent.context_window_limit > 0 && (() => {
              const ctxTokens = agent.context_total_tokens > 0
                ? agent.context_total_tokens
                : agent.context_input_tokens
              const ctxPct = Math.min(1, ctxTokens / agent.context_window_limit)
              return (
                <div>
                  <div style={{ color: "#555", fontSize: 10, marginBottom: 4 }}>Context Window</div>
                  <div style={{ height: 8, background: "#222", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      width: `${Math.round(ctxPct * 100)}%`,
                      height: "100%",
                      background: ctxPct > 0.8 ? "#f84" : ctxPct > 0.6 ? "#ff4" : "#4f4",
                      borderRadius: 4,
                      transition: "width 0.3s",
                    }} />
                  </div>
                  <div style={{ color: "#666", fontSize: 10, marginTop: 2 }}>
                    {ft(ctxTokens)} / {ft(agent.context_window_limit)} ({Math.round(ctxPct * 100)}%)
                  </div>
                </div>
              )
            })()}

            {agent.token_input_total > 0 && (
              <div style={{ color: "#666", fontSize: 10, marginTop: 8 }}>
                lifetime tokens: {ft(agent.token_input_total)} in / {ft(agent.token_output_total)} out
                {agent.cache_read_tokens > 0 && ` / ${ft(agent.cache_read_tokens)} cache read`}
                {agent.context_total_tokens > agent.session_total_tokens &&
                  ` · ctx: ${ft(agent.context_total_tokens)}`}
              </div>
            )}
            {agent.cache_read_tokens > 0 && agent.token_input_total > 0 && (() => {
              const pct = Math.min(1, agent.cache_read_tokens / agent.token_input_total)
              return (
                <div style={{ marginTop: 6 }}>
                  <div style={{ color: "#555", fontSize: 10, marginBottom: 2 }}>Cache hit rate</div>
                  <div style={{ height: 6, background: "#222", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${pct * 100}%`, height: "100%", background: "#48f", borderRadius: 3, transition: "width 0.3s" }} />
                  </div>
                  <div style={{ color: "#48f", fontSize: 10, marginTop: 2 }}>
                    {Math.round(pct * 100)}% · {ft(agent.cache_read_tokens)} / {ft(agent.token_input_total)} input
                  </div>
                </div>
              )
            })()}

            <div style={{ marginTop: 14 }}>
              <div style={{ color: "#555", fontSize: 10, marginBottom: 6 }}>Tags</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {tags.map((t) => (
                  <span key={t} style={{ background: "#1a2a1a", border: "1px solid #3a5a3a", color: "#6f6", borderRadius: 3, fontSize: 10, padding: "2px 7px", display: "flex", alignItems: "center", gap: 4 }}>
                    {t}
                    <button
                      onClick={() => removeTag(t)}
                      style={{ background: "none", border: "none", color: "#4a6a4a", cursor: "pointer", padding: 0, fontSize: 11, lineHeight: 1 }}
                    >✕</button>
                  </span>
                ))}
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addTag() }}
                    placeholder="add tag…"
                    style={{ background: "#111", border: "1px solid #333", color: "#ccc", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontFamily: "monospace", width: 80 }}
                  />
                  <button
                    onClick={addTag}
                    style={{ background: "none", border: "1px solid #333", color: "#666", borderRadius: 3, padding: "2px 7px", cursor: "pointer", fontFamily: "monospace", fontSize: 11 }}
                  >+</button>
                </div>
              </div>
            </div>
          </>
        )}

        {tab === "logs" && (() => {
          const toolNames = [...new Set(
            agentLogs.filter(e => e.log_type === "tool_start" && e.tool_name).map(e => e.tool_name!)
          )]
          const visibleLogs = toolFilter
            ? agentLogs.filter(e => !e.tool_name || e.tool_name === toolFilter)
            : agentLogs
          return (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ color: "#555", fontSize: 10 }}>
                {visibleLogs.length}{toolFilter ? ` / ${agentLogs.length}` : ""} entries
              </div>
            </div>
            {toolNames.length > 1 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                <button
                  onClick={() => setToolFilter(null)}
                  style={{
                    background: toolFilter === null ? "rgba(255,255,255,0.1)" : "none",
                    border: `1px solid ${toolFilter === null ? "#666" : "#333"}`,
                    color: toolFilter === null ? "#ccc" : "#555",
                    borderRadius: 10, padding: "1px 8px", cursor: "pointer",
                    fontFamily: "monospace", fontSize: 9,
                  }}
                >All</button>
                {toolNames.map(tn => {
                  const tc = TOOL_COLORS[tn]
                  const active = toolFilter === tn
                  const col = tc ? `rgb(${tc[0]},${tc[1]},${tc[2]})` : "#888"
                  return (
                    <button
                      key={tn}
                      onClick={() => setToolFilter(active ? null : tn)}
                      style={{
                        background: active ? `rgba(${tc?.[0]??128},${tc?.[1]??128},${tc?.[2]??128},0.15)` : "none",
                        border: `1px solid ${active ? col : "#333"}`,
                        color: active ? col : "#555",
                        borderRadius: 10, padding: "1px 8px", cursor: "pointer",
                        fontFamily: "monospace", fontSize: 9,
                      }}
                    >{tn}</button>
                  )
                })}
              </div>
            )}
            {visibleLogs.length === 0 && (
              <div style={{ color: "#555", textAlign: "center", padding: 20, fontSize: 11 }}>
                {agentLogs.length === 0 ? "no log entries yet" : "no entries for this filter"}
              </div>
            )}
            {visibleLogs.map((entry, i) => {
              const toolColor = LOG_TYPE_COLORS[entry.log_type] ?? "#888"
              return (
                <div key={`${entry.timestamp_ms}-${i}`}>
                  <div
                    style={{
                      padding: "3px 0",
                      fontSize: 10,
                      lineHeight: "16px",
                      borderBottom: entry.tool_input ? "none" : "1px solid rgba(255,255,255,0.03)",
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    <span style={{ color: "#444", flexShrink: 0, width: 52 }}>
                      {fmtTime(entry.timestamp_ms)}
                    </span>
                    <span style={{ color: toolColor, flexShrink: 0, fontSize: 9, width: 50 }}>
                      {entry.log_type === "tool_start" ? "start" : entry.log_type === "tool_result" ? "done" : entry.log_type === "waiting" ? "\u23F3" : entry.log_type}
                    </span>
                    <span style={{ color: "#aaa", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.tool_input ?? entry.detail}
                    </span>
                    {entry.duration_ms != null && (
                      <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                        <div style={{
                          width: Math.min(48, Math.round(entry.duration_ms / 200)),
                          height: 3, background: toolColor,
                          borderRadius: 2, opacity: 0.5,
                        }} />
                        <span style={{ color: "#555", fontSize: 8 }}>
                          {entry.duration_ms < 1000 ? `${entry.duration_ms}ms` : `${(entry.duration_ms / 1000).toFixed(1)}s`}
                        </span>
                      </div>
                    )}
                  </div>
                  {entry.tool_input && (
                    <div style={{
                      padding: "0 0 3px 58px",
                      fontSize: 9,
                      color: "#666",
                      fontStyle: "italic",
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                      wordBreak: "break-all",
                      lineHeight: "14px",
                    }}>
                      {entry.detail}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          )
        })()}

        {tab === "stats" && (() => {
          const toolCounts = new Map<string, number>()
          for (const e of agentLogs) {
            if (e.log_type === "tool_start" && e.tool_name) {
              toolCounts.set(e.tool_name, (toolCounts.get(e.tool_name) ?? 0) + 1)
            }
          }
          const sortedTools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])
          const maxCount = sortedTools[0]?.[1] ?? 1

          const totalElapsed = nowMs - agent.created_at_ms
          const activeMs = agent.active_ms
          const waitingMs = agentLogs
            .filter(e => e.log_type === "waiting" && e.duration_ms != null)
            .reduce((s, e) => s + (e.duration_ms ?? 0), 0)
          const idleMs = Math.max(0, totalElapsed - activeMs - waitingMs)

          const cost = agent.token_input_total * PRICE_INPUT
            + agent.token_output_total * PRICE_OUTPUT
            + agent.cache_read_tokens * PRICE_CACHE

          const cacheHitPct = agent.token_input_total > 0
            ? Math.round(Math.min(1, agent.cache_read_tokens / agent.token_input_total) * 100)
            : 0

          function StatBar({ label, ms, total, color }: { label: string; ms: number; total: number; color: string }) {
            const pct = total > 0 ? Math.min(1, ms / total) : 0
            const secs = Math.round(ms / 1000)
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <div style={{ width: 50, color: "#666", fontSize: 10, textAlign: "right", flexShrink: 0 }}>{label}</div>
                <div style={{ flex: 1, height: 6, background: "#1a1a2a", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${pct * 100}%`, height: "100%", background: color, borderRadius: 3 }} />
                </div>
                <div style={{ width: 56, color: "#555", fontSize: 9, flexShrink: 0 }}>
                  {secs}s ({Math.round(pct * 100)}%)
                </div>
              </div>
            )
          }

          return (
            <div>
              {sortedTools.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ color: "#555", fontSize: 10, marginBottom: 8 }}>Tool Usage</div>
                  {sortedTools.map(([name, count]) => {
                    const tc = TOOL_COLORS[name]
                    const col = tc ? `rgb(${tc[0]},${tc[1]},${tc[2]})` : "#888"
                    return (
                      <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 60, color: col, fontSize: 10, textAlign: "right", flexShrink: 0 }}>{name}</div>
                        <div style={{ flex: 1, height: 8, background: "#1a1a2a", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${(count / maxCount) * 100}%`, height: "100%", background: col, opacity: 0.7, borderRadius: 3 }} />
                        </div>
                        <div style={{ width: 28, color: "#666", fontSize: 9, flexShrink: 0, textAlign: "right" }}>{count}</div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <div style={{ color: "#555", fontSize: 10, marginBottom: 8 }}>Time Breakdown</div>
                <StatBar label="Active" ms={activeMs} total={totalElapsed} color="#4f4" />
                <StatBar label="Waiting" ms={waitingMs} total={totalElapsed} color="#ff4" />
                <StatBar label="Idle" ms={idleMs} total={totalElapsed} color="#444" />
              </div>

              {agent.token_input_total > 0 && cacheHitPct > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ color: "#555", fontSize: 10, marginBottom: 4 }}>Cache hit rate</div>
                  <div style={{ height: 6, background: "#1a1a2a", borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                    <div style={{ width: `${cacheHitPct}%`, height: "100%", background: "#48f", borderRadius: 3 }} />
                  </div>
                  <div style={{ color: "#48f", fontSize: 10 }}>
                    {cacheHitPct}% · {ft(agent.cache_read_tokens)} / {ft(agent.token_input_total)} input
                  </div>
                </div>
              )}

              {cost > 0.00001 && (
                <div>
                  <div style={{ color: "#555", fontSize: 10, marginBottom: 4 }}>Estimated cost</div>
                  <div style={{ color: "#fa0", fontSize: 14, fontWeight: "bold" }}>~${cost.toFixed(4)}</div>
                  <div style={{ color: "#555", fontSize: 9, marginTop: 2 }}>
                    {ft(agent.token_input_total)} in · {ft(agent.token_output_total)} out · {ft(agent.cache_read_tokens)} cache
                  </div>
                </div>
              )}

              {sortedTools.length === 0 && cost <= 0.00001 && (
                <div style={{ color: "#555", textAlign: "center", padding: 20, fontSize: 11 }}>
                  no stats yet
                </div>
              )}
            </div>
          )
        })()}

        {tab === "tree" && (
          <div>
            <div style={{ color: "#888", fontSize: 11, marginBottom: 8 }}>
              Agent hierarchy for this session
            </div>
            <div style={{ paddingLeft: 0 }}>
              {/* parent link */}
              {parent && (
                <div style={{ padding: "4px 8px", marginBottom: 4, color: "#666", fontSize: 11 }}>
                  parent: <span style={{ color: "#aaa" }}>{parent.label}</span>
                  <span style={{ color: "#555", marginLeft: 6, fontSize: 9 }}>(#{parent.agent_id})</span>
                </div>
              )}
              {/* self */}
              <div style={{
                padding: "6px 10px",
                background: "rgba(68,255,68,0.08)",
                border: "1px solid rgba(68,255,68,0.2)",
                borderRadius: 6,
                color: "#4f4",
                fontSize: 11,
                marginBottom: 4,
                fontWeight: "bold",
              }}>
                {agent.label}
                <span style={{ color: "#888", fontWeight: "normal", marginLeft: 8, fontSize: 10 }}>
                  (this agent · {agent.tool_call_count} tools)
                </span>
              </div>
              {/* children */}
              {children.length > 0 && (
                <div style={{ paddingLeft: 16, marginTop: 4 }}>
                  <div style={{ color: "#555", fontSize: 10, marginBottom: 4 }}>sub-agents:</div>
                  {children.map((c) => (
                    <div key={c.agent_id} style={{
                      padding: "4px 8px",
                      color: "#aaa",
                      fontSize: 11,
                      borderLeft: "1px solid rgba(255,255,255,0.08)",
                      marginBottom: 2,
                    }}>
                      {c.label}
                      <span style={{ color: "#555", marginLeft: 6, fontSize: 9 }}>
                        ({c.tool_call_count} tools · #{c.desk_index})
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* completed children (subagents that finished and left) */}
              {agent.completed_children.length > 0 && (
                <div style={{ paddingLeft: 16, marginTop: 4 }}>
                  <div style={{ color: "#555", fontSize: 10, marginBottom: 4 }}>used sub-agents:</div>
                  {agent.completed_children.map((c) => (
                    <div key={c.agent_id} style={{
                      padding: "4px 8px",
                      color: "#666",
                      fontSize: 11,
                      borderLeft: "1px solid rgba(255,255,255,0.05)",
                      marginBottom: 2,
                    }}>
                      {c.label}
                      <span style={{ color: "#555", marginLeft: 6, fontSize: 9 }}>
                        ({c.tool_call_count} tools · {ft(c.token_input_total + c.token_output_total)} tokens)
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!parent && children.length === 0 && agent.completed_children.length === 0 && (
                <div style={{ color: "#555", textAlign: "center", padding: 20, fontSize: 11 }}>
                  no parent or sub-agents
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
