import { useRef, useEffect, useState } from "react"
import { Container, Graphics } from "pixi.js"
import type { WireScene, WireAgent, WireLogEntry } from "../types"
import { AgentEntity } from "../engine/agent-entity"
import type { EntityState } from "../engine/agent-entity"
import { deskCenter, computeZones, COLS, DESK_W, DESK_H, DESK_GAP } from "../engine/waypoints"
import { createOfficeApp } from "../engine/pixi-app"
import { buildFloor, rebuildZones } from "./layers/floor-layer"
import { DeskLayer } from "./layers/desk-layer"
import { AgentLayer } from "./layers/agent-layer"
import { FxLayer, createElevatorState, tickElevator, drawElevator } from "./layers/fx-layer"
import type { ElevatorState } from "./layers/fx-layer"
import { UILayer, createSpeechBubble, deriveBubbleLines } from "./layers/ui-layer"
import type { SpeechBubble } from "./layers/ui-layer"
import { AgentDetailModal } from "./Office"
import { clearTextureCache } from "./layers/agent-layer"
import { setLiveAgentsCache } from "../liveAgentsCache"

// ── Layout ─────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

const TOOL_COLORS: Record<string, [number, number, number]> = {
  Bash: [255, 136, 68],
  Read: [136, 68, 255],
  Write: [0, 255, 65],
  Edit: [68, 136, 255],
  MultiEdit: [68, 136, 255],
  Glob: [255, 68, 255],
  Grep: [255, 68, 255],
  Agent: [255, 255, 68],
  Task: [255, 255, 68],
}

function deriveEntityState(agent: WireAgent): EntityState {
  if (agent.exiting_at_ms !== null) return "Exiting"
  if (agent.state.type === "Active") return "Active"
  if (agent.state.type === "Waiting") return "Waiting"
  return "Idle"
}

// ── Decoration drawing ─────────────────────────────────────────────────────

function buildDecorationsPixi(container: Container, rows: number, canvasW: number): void {
  const lastX = 40 + (COLS - 1) * (DESK_W + DESK_GAP)
  const spots: Array<{ x: number; y: number; w: number; h: number }> = []

  for (let r = 0; r < rows; r++) {
    spots.push({
      x: lastX + DESK_W + 14,
      y: 40 + r * (DESK_H + DESK_GAP) + 8,
      w: 20,
      h: 20,
    })
  }
  if (rows > 0) {
    const lastRowY = 40 + (rows - 1) * (DESK_H + DESK_GAP)
    spots.push({
      x: 50,
      y: lastRowY + DESK_H + 28,
      w: 20,
      h: 20,
    })
  }

  // Conveyor belt at bottom
  const beltY = rows * (DESK_H + DESK_GAP) + 50
  const beltG = new Graphics()
  beltG.rect(40, beltY, canvasW - 100, 8).fill({ color: 0x0a0a1a })
  beltG.rect(40, beltY, canvasW - 100, 8).stroke({ color: 0x001133, width: 1 })
  for (let bx = 50; bx < canvasW - 100; bx += 16) {
    beltG.rect(bx, beltY + 2, 8, 4).fill({ color: 0x001a2a, alpha: 0.5 })
  }
  container.addChild(beltG)

  for (const spot of spots) {
    const g = new Graphics()
    g.x = spot.x
    g.y = spot.y
    drawServerRack(g, spot.w, spot.h)
    container.addChild(g)
  }
}

function drawServerRack(g: Graphics, w: number, h: number): void {
  g.rect(0, 0, w, h).fill({ color: 0x0a0a18 })
  g.rect(0, 0, w, h).stroke({ color: 0x1a1a3a, width: 1 })
  const unitH = Math.floor(h / 5)
  const ledColors = [0x00ff41, 0x00ff41, 0xff8800, 0x00ff41, 0x00ff41]
  for (let i = 0; i < 5; i++) {
    const uy = 1 + i * unitH
    g.rect(2, uy, w - 4, unitH - 1).fill({ color: 0x111122 })
    // Face plate
    g.rect(3, uy + 1, w - 8, unitH - 3).fill({ color: 0x0d0d20 })
    // LED
    g.circle(w - 5, uy + Math.floor(unitH / 2), 1.5).fill({ color: ledColors[i] })
  }
}

function buildSkyline(container: Container, canvasW: number, canvasH: number): void {
  const g = new Graphics()
  const skyH = Math.floor(canvasH * 0.15)
  // Buildings silhouettes
  const buildings = [
    { x: 0, w: 30, h: skyH * 0.9 },
    { x: 28, w: 20, h: skyH * 0.6 },
    { x: 46, w: 40, h: skyH * 0.85 },
    { x: 84, w: 25, h: skyH * 0.5 },
    { x: 107, w: 35, h: skyH * 0.95 },
    { x: 140, w: 20, h: skyH * 0.7 },
    { x: 158, w: 50, h: skyH * 0.8 },
    { x: 206, w: 30, h: skyH * 0.6 },
    { x: 234, w: 45, h: skyH },
    { x: 277, w: 25, h: skyH * 0.55 },
  ]
  for (const b of buildings) {
    g.rect(b.x, skyH - b.h, b.w, b.h).fill({ color: 0x050520 })
    // Scatter neon windows
    for (let wy = skyH - b.h + 3; wy < skyH - 4; wy += 5) {
      for (let wx = b.x + 3; wx < b.x + b.w - 4; wx += 5) {
        const rnd = Math.abs(Math.sin(wx * 1.3 + wy * 7.1)) // deterministic pseudo-random
        if (rnd > 0.6) {
          const winColor = rnd > 0.85 ? 0xff4400 : 0x00e5ff
          const winAlpha = rnd > 0.85 ? 0.18 : 0.25
          g.rect(wx, wy, 2, 2).fill({ color: winColor, alpha: winAlpha })
        }
      }
    }
  }
  // Atmospheric haze at horizon
  g.rect(0, skyH - 3, canvasW, 1).fill({ color: 0x001133, alpha: 0.8 })
  g.rect(0, skyH - 2, canvasW, 1).fill({ color: 0x002244, alpha: 0.5 })
  g.rect(0, skyH - 1, canvasW, 1).fill({ color: 0x003355, alpha: 0.3 })
  container.addChild(g)
}

// ── OfficePixi component ──────────────────────────────────────────────────

type Props = {
  scene: WireScene | null
  logEntries?: WireLogEntry[]
}

export function OfficePixi({ scene, logEntries }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<WireScene | null>(null)
  sceneRef.current = scene

  // PixiJS refs (survive re-renders)
  const appRef = useRef<Awaited<ReturnType<typeof createOfficeApp>> | null>(null)
  const entityMapRef = useRef<Map<number, AgentEntity>>(new Map())
  const bubblesRef = useRef<Map<number, SpeechBubble>>(new Map())
  const elevatorRef = useRef<ElevatorState>(createElevatorState())
  const prevToolsRef = useRef<Map<number, string | null>>(new Map())
  const prevStatesRef = useRef<Map<number, string>>(new Map())
  const prevTokensRef = useRef<Map<number, { cache: number; input: number }>>(new Map())
  const prevChildrenRef = useRef<Set<number>>(new Set())
  const fxRef = useRef<FxLayer | null>(null)
  const agentLayerRef = useRef<AgentLayer | null>(null)
  const deskLayerRef = useRef<DeskLayer | null>(null)
  const uiLayerRef = useRef<UILayer | null>(null)
  const elevGfxRef = useRef<Graphics | null>(null)
  const spotlightGfxRef = useRef<Graphics | null>(null)
  const serverBlinkGfxRef = useRef<Graphics | null>(null)
  const serverSpotsRef = useRef<Array<{ x: number; y: number; w: number; h: number }>>([])


  // UI state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; agent: WireAgent } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<WireAgent | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const [modalTab, setModalTab] = useState<"overview" | "logs" | "stats" | "tree">("overview")

  // Canvas dimensions (driven by max_desks)
  const maxDesks = scene?.max_desks ?? 16
  const rows = Math.ceil(maxDesks / COLS)
  const canvasW = COLS * (DESK_W + DESK_GAP) + 80 + 40 + 60
  const canvasH = rows * (DESK_H + DESK_GAP) + 80

  // ── Escape key to close modal ──
  useEffect(() => {
    if (!selectedAgent) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedAgent(null) }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [selectedAgent])

  // ── Context menu dismiss ──
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = () => setContextMenu(null)
    document.addEventListener("click", dismiss)
    return () => document.removeEventListener("click", dismiss)
  }, [contextMenu])

  // ── PixiJS initialization ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let destroyed = false

    createOfficeApp(canvas, canvasW, canvasH).then((stage) => {
      if (destroyed) { stage.app.destroy(); return }
      appRef.current = stage

      canvas.style.display = "block"

      buildSkyline(stage.layers.background, canvasW, canvasH)
      buildFloor(stage.layers.floor, canvasW, canvasH)

      // Server spots for blink animation
      const lastX = 40 + (COLS - 1) * (DESK_W + DESK_GAP)
      const sSpots: Array<{ x: number; y: number; w: number; h: number }> = []
      for (let r = 0; r < rows; r++) {
        sSpots.push({ x: lastX + DESK_W + 14, y: 40 + r * (DESK_H + DESK_GAP) + 8, w: 20, h: 20 })
      }
      if (rows > 0) {
        const lastRowY = 40 + (rows - 1) * (DESK_H + DESK_GAP)
        sSpots.push({ x: 50, y: lastRowY + DESK_H + 28, w: 20, h: 20 })
      }
      serverSpotsRef.current = sSpots
      buildDecorationsPixi(stage.layers.decorations, rows, canvasW)

      // Server blink overlay (redrawn each frame)
      const serverBlinkGfx = new Graphics()
      serverBlinkGfxRef.current = serverBlinkGfx
      stage.layers.decorations.addChild(serverBlinkGfx)

      const elevGfx = new Graphics()
      elevGfxRef.current = elevGfx
      stage.layers.decorations.addChild(elevGfx)

      // Spotlight layer gfx
      const spotlightGfx = new Graphics()
      spotlightGfxRef.current = spotlightGfx
      stage.layers.spotlights.addChild(spotlightGfx)

      deskLayerRef.current = new DeskLayer(stage.layers.desks)
      agentLayerRef.current = new AgentLayer(stage.layers.agents, stage.app)
      fxRef.current = new FxLayer(stage.layers.fxFloor, stage.layers.fxAir, canvasW, canvasH)
      uiLayerRef.current = new UILayer(stage.layers.ui)

      // Scale stage to fill container
      const containerEl = containerRef.current
      if (containerEl) {
        const rect = containerEl.getBoundingClientRect()
        const scale = Math.min(
          rect.width  > 0 ? rect.width  / canvasW : 1,
          rect.height > 0 ? rect.height / canvasH : 1,
        )
        stage.app.renderer.resize(Math.round(canvasW * scale), Math.round(canvasH * scale))
        stage.app.stage.scale.set(scale)
      }

      stage.app.ticker.add((ticker) => {
        try {
        const dt = ticker.deltaMS
        const nowMs = Date.now()
        const s = sceneRef.current
        const t = performance.now()
        const zones = computeZones(canvasW, canvasH)

        const entities = [...entityMapRef.current.values()]
        const agentMapAll = new Map<number, WireAgent>()
        if (s) {
          for (const [idStr, a] of Object.entries(s.agents)) {
            agentMapAll.set(Number(idStr), a)
          }
        }

        // FX detection (must happen before entity update uses entity.pos)
        if (s) {
          for (const agent of Object.values(s.agents)) {
            const entity = entityMapRef.current.get(agent.agent_id)
            if (!entity) continue

            // Tool change → ripple + spark
            const prevTool = prevToolsRef.current.get(agent.agent_id)
            if (agent.current_tool && agent.current_tool !== prevTool) {
              const tc = TOOL_COLORS[agent.current_tool] ?? ([0, 255, 65] as [number, number, number])
              fxRef.current?.spawnToolEffect(entity.pos.x, entity.pos.y, tc)
            }
            prevToolsRef.current.set(agent.agent_id, agent.current_tool)

            // State change → speech bubble
            const prevState = prevStatesRef.current.get(agent.agent_id)
            if (agent.state.type !== prevState && prevState !== undefined) {
              const detail = agent.state.type === "Active" ? agent.state.detail : null
              const reason = agent.state.type === "Waiting" ? agent.state.reason : undefined
              const lines = deriveBubbleLines(agent.state.type, agent.current_tool, detail, reason)
              if (lines.length > 0) {
                bubblesRef.current.set(
                  agent.agent_id,
                  createSpeechBubble(agent.agent_id, lines, entity.pos.x, entity.pos.y, nowMs),
                )
              }
            }
            prevStatesRef.current.set(agent.agent_id, agent.state.type)

            // Token pulse
            const prevTok = prevTokensRef.current.get(agent.agent_id)
            if (prevTok) {
              if (agent.context_input_tokens - prevTok.input > 1000) {
                fxRef.current?.spawnTokenPulse(entity.pos.x, entity.pos.y)
              }
              if (agent.cache_read_tokens - prevTok.cache > 50_000) {
                fxRef.current?.spawnLightning(zones.serverRack.x, zones.serverRack.y, entity.pos.x, entity.pos.y)
              }
            }
            prevTokensRef.current.set(agent.agent_id, {
              cache: agent.cache_read_tokens,
              input: agent.context_input_tokens,
            })

            // Sub-agent spawn
            if (agent.parent_id !== null && !prevChildrenRef.current.has(agent.agent_id)) {
              prevChildrenRef.current.add(agent.agent_id)
              const parentEntity = entityMapRef.current.get(agent.parent_id)
              parentEntity?.triggerSpawnWalk(nowMs)
              fxRef.current?.spawnPortalBurst(zones.whiteboard.x, zones.whiteboard.y)
            }

            // Commit belt: Write/Edit tool completing
            const commitTools = new Set(["Write", "Edit", "MultiEdit"])
            if (prevTool && commitTools.has(prevTool) && agent.current_tool !== prevTool) {
              const beltY = rows * (DESK_H + DESK_GAP) + 50
              fxRef.current?.spawnCommitBox(entity.pos.x, beltY)
            }
          }
        }

        // Update entity physics
        for (const entity of entities) {
          const agent = agentMapAll.get(entity.id)
          if (!agent) continue
          entity.state = deriveEntityState(agent)
          entity.homeDesk = deskCenter(agent.desk_index)

          const peers = entities.filter((e) => e.id !== entity.id)
          const sessionPeers = entities.filter(
            (e) => e.id !== entity.id && agentMapAll.get(e.id)?.session_id === agent.session_id,
          )
          entity.update(dt, nowMs, canvasW, canvasH, zones, peers, sessionPeers)
        }

        // Expire bubbles
        for (const [id, bubble] of bubblesRef.current) {
          if (nowMs - bubble.createdAt >= bubble.duration) bubblesRef.current.delete(id)
        }

        // Elevator
        tickElevator(elevatorRef.current, dt)
        const elevGfx = elevGfxRef.current
        if (elevGfx) {
          elevGfx.clear()
          drawElevator(elevGfx, elevatorRef.current, canvasW - 36, canvasH, nowMs)
        }

        // Server rack LED blink
        const serverBlinkGfx = serverBlinkGfxRef.current
        if (serverBlinkGfx) {
          serverBlinkGfx.clear()
          const blinkState = Math.floor(nowMs / 300) % 2
          for (const spot of serverSpotsRef.current) {
            const unitH = Math.floor(spot.h / 5)
            for (let i = 0; i < 5; i++) {
              const uy = spot.y + 1 + i * unitH
              const barAlpha = 0.3 + 0.3 * Math.sin(nowMs * 0.02 + i * 1.2)
              serverBlinkGfx.rect(spot.x + 3, uy + 1, spot.w - 8, 1).fill({ color: 0x00e5ff, alpha: barAlpha })
              if (blinkState === i % 2) {
                serverBlinkGfx.circle(spot.x + spot.w - 5, uy + Math.floor(unitH / 2), 1.5).fill({ color: 0x00ff41, alpha: 0.9 })
              }
            }
          }
        }

        // Spotlights — dark overlay with lit cones for active agents
        const spotlightGfx = spotlightGfxRef.current
        if (spotlightGfx) {
          spotlightGfx.clear()
          const activeEntities = entities.filter((e) => {
            const ag = agentMapAll.get(e.id)
            return ag && ag.state.type === "Active" && ag.exiting_at_ms === null
          })
          if (activeEntities.length > 0) {
            // Full-canvas dark shadow
            spotlightGfx.rect(0, 0, canvasW, canvasH).fill({ color: 0x000000, alpha: 0.45 })
            // Light cones for each active agent
            const spotR = 55 + 15 * (0.5 + 0.5 * Math.sin(nowMs * 0.004))
            for (const entity of activeEntities) {
              const steps = 8
              for (let si = steps; si > 0; si--) {
                const r = (si / steps) * spotR
                const a = (1 - si / steps) * 0.4
                spotlightGfx.circle(entity.pos.x, entity.pos.y, r).fill({ color: 0x1a3020, alpha: a })
              }
            }
          }
        }

        // Render all layers
        deskLayerRef.current?.update(s?.agents ?? {}, maxDesks, nowMs)
        agentLayerRef.current?.update(entities, agentMapAll, nowMs, t, selectedAgentId ?? undefined)
        fxRef.current?.update(dt, nowMs, canvasW, canvasH)
        uiLayerRef.current?.update(entities, agentMapAll, bubblesRef.current, nowMs, canvasH)
        } catch (err) {
          console.error("[OfficePixi] ticker error:", err)
        }
      })
    })

    return () => {
      destroyed = true
      clearTextureCache()
      appRef.current?.app.destroy(false)
      appRef.current = null
    }
  }, [canvasW, canvasH, maxDesks, rows]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Responsive resize via ResizeObserver ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const apply = () => {
      const app = appRef.current?.app
      if (!app) return
      const rect = el.getBoundingClientRect()
      const scale = Math.min(
        rect.width  > 0 ? rect.width  / canvasW : 1,
        rect.height > 0 ? rect.height / canvasH : 1,
      )
      if (scale <= 0) return
      app.renderer.resize(Math.round(canvasW * scale), Math.round(canvasH * scale))
      app.stage.scale.set(scale)
    }
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [canvasW, canvasH])

  // ── Sync entities when scene changes ──
  useEffect(() => {
    if (!scene) return
    const nowMs = scene.now_ms || Date.now()
    const stage = appRef.current

    for (const agent of Object.values(scene.agents)) {
      if (!entityMapRef.current.has(agent.agent_id)) {
        entityMapRef.current.set(agent.agent_id, new AgentEntity(agent, nowMs))
        prevTokensRef.current.set(agent.agent_id, {
          cache: agent.cache_read_tokens,
          input: agent.context_input_tokens,
        })
      } else {
        entityMapRef.current.get(agent.agent_id)!.homeDesk = deskCenter(agent.desk_index)
      }
    }

    for (const id of entityMapRef.current.keys()) {
      if (!scene.agents[id]) entityMapRef.current.delete(id)
    }

    if (stage) {
      rebuildZones(
        stage.layers.zones,
        Object.values(scene.agents).map((a) => ({ source: a.source, desk_index: a.desk_index })),
      )
    }
  }, [scene])

  // ── Hit detection helpers ──
  function toCanvasCoords(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
    return {
      x: (clientX - rect.left) * canvasW / rect.width,
      y: (clientY - rect.top)  * canvasH / rect.height,
    }
  }

  function deskIndexAtPoint(mx: number, my: number): number | null {
    const paddingX = 40
    const paddingY = 40
    const rows = Math.ceil(maxDesks / COLS)
    const col = Math.floor((mx - paddingX) / (DESK_W + DESK_GAP))
    const row = Math.floor((my - paddingY) / (DESK_H + DESK_GAP))
    const idx = row * COLS + col
    if (col < 0 || col >= COLS || row < 0 || row >= rows || idx >= maxDesks) return null
    return idx
  }

  function agentAtDesk(deskIdx: number): WireAgent | null {
    const s = sceneRef.current
    if (!s) return null
    for (const agent of Object.values(s.agents)) {
      if (agent.desk_index === deskIdx) return agent
    }
    return null
  }

  function agentAtPoint(mx: number, my: number): WireAgent | null {
    const s = sceneRef.current
    if (!s) return null
    for (const entity of entityMapRef.current.values()) {
      const dx = mx - entity.pos.x
      const dy = my - entity.pos.y
      if (dx * dx + dy * dy < 20 * 20) {
        return s.agents[entity.id] ?? null
      }
    }
    return null
  }

  function findAgent(mx: number, my: number): WireAgent | null {
    const deskIdx = deskIndexAtPoint(mx, my)
    if (deskIdx !== null) {
      const byDesk = agentAtDesk(deskIdx)
      if (byDesk) return byDesk
    }
    return agentAtPoint(mx, my)
  }

  // ── Mouse handlers ──
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (contextMenu) return // right-click menu open, ignore
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const { x, y } = toCanvasCoords(e.clientX, e.clientY, rect)
    const found = findAgent(x, y)
    setSelectedAgentId(found ? found.agent_id : null)
  }

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const { x, y } = toCanvasCoords(e.clientX, e.clientY, rect)
    const found = findAgent(x, y)
    if (found) setContextMenu({ x: e.clientX, y: e.clientY, agent: found })
  }

  const copyState = (agent: WireAgent) => {
    navigator.clipboard.writeText(JSON.stringify({ ...agent, observed_at_ms: sceneRef.current?.now_ms ?? 0 }, null, 2))
    setContextMenu(null)
  }

  const copyId = (agent: WireAgent) => {
    navigator.clipboard.writeText(agent.session_id)
    setCopiedId(agent.agent_id.toString())
    setContextMenu(null)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        onContextMenu={handleContextMenu}
        onClick={handleCanvasClick}
        style={{
          display: "block",
          margin: "0 auto",
          borderRadius: 8,
          cursor: "pointer",
          background: "linear-gradient(to bottom, #020214, #060620 30%, var(--bg-canvas))",
        }}
      />

      {contextMenu && (
        <div style={{
          position: "fixed",
          left: contextMenu.x,
          top: contextMenu.y,
          zIndex: "var(--z-context-menu)",
          background: "var(--bg-glass-menu)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid var(--border-hover)",
          borderRadius: 8,
          padding: "4px 0",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-on-surface)",
          pointerEvents: "auto",
          minWidth: 160,
          boxShadow: "var(--shadow-menu)",
        }}>
          {[
            { label: "Inspect", color: "var(--text-primary)", action: () => { setContextMenu(null); setSelectedAgent(contextMenu.agent) } },
            { label: "Copy State", color: "var(--text-on-surface-dim)", action: () => copyState(contextMenu.agent) },
            {
              label: copiedId === contextMenu.agent.agent_id.toString() ? "Copied!" : "Copy ID",
              color: copiedId === contextMenu.agent.agent_id.toString() ? "var(--text-primary)" : "#556677",
              action: () => copyId(contextMenu.agent),
            },
            { label: "Compare", color: "var(--text-primary)", action: () => { setContextMenu(null); const ag = contextMenu.agent; sessionStorage.setItem("compare_agent_a", JSON.stringify(ag)); setLiveAgentsCache(Object.values(sceneRef.current?.agents ?? [])); window.location.hash = `#/history/compare/${ag.session_id}` } },
          ].map(({ label, color, action }) => (
            <div
              key={label}
              onClick={(e) => { e.stopPropagation(); action() }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              style={{ padding: "8px 14px", cursor: "pointer", color, transition: "background 0.1s" }}
            >
              {label}
            </div>
          ))}
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
