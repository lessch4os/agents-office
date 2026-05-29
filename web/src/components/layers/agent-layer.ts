import { Application, Container, Graphics, RenderTexture, Sprite } from "pixi.js"
import type { AgentEntity } from "../../engine/agent-entity"
import type { WireAgent } from "../../types"
import { SPRITES, spriteWidth, spriteHeight } from "../sprites"
import type { Pose } from "../sprites"
import { SPRITE_SCALE } from "../../engine/waypoints"

// ── Color helpers ──────────────────────────────────────────────────────────

function toHex(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}

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
  Idle: [40, 40, 60],
  Active: [0, 255, 65],
  Waiting: [0, 220, 255],
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

function poseForAgent(agent: WireAgent): Pose {
  if (agent.state.type === "Active") {
    const act = agent.state.activity
    if (act === "reading") return "reading"
    if (act === "thinking") return "thinking"
    return "active"
  }
  if (agent.state.type === "Waiting") return "waiting"
  return "idle"
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

// ── Texture cache ─────────────────────────────────────────────────────────

const textureCache = new Map<string, RenderTexture>()

function getSpriteTexture(
  app: Application,
  pose: Pose,
  r: number,
  g: number,
  b: number,
): RenderTexture {
  const key = `${pose}:${r}:${g}:${b}`
  const cached = textureCache.get(key)
  if (cached) return cached

  const sprite = SPRITES[pose]
  const sw = spriteWidth(sprite)
  const sh = spriteHeight(sprite)
  const scale = SPRITE_SCALE
  const outlinePad = scale

  const texW = sw * scale + outlinePad * 2
  const texH = sh * scale + outlinePad * 2
  const ox = outlinePad
  const oy = outlinePad

  const gfx = new Graphics()

  // Outline pass: for each visible pixel, render black at 4 cardinal neighbors
  const outlineNeighbors: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (let row = 0; row < sh; row++) {
    for (let col = 0; col < sw; col++) {
      if (sprite[row][col] < 0) continue
      for (const [dc, dr] of outlineNeighbors) {
        gfx.rect(ox + (col + dc) * scale, oy + (row + dr) * scale, scale, scale).fill({ color: 0x666666 })
      }
    }
  }

  // Color pass: render colored pixels on top (overwrites interior outlines)
  for (let row = 0; row < sh; row++) {
    for (let col = 0; col < sw; col++) {
      const brightness = sprite[row][col]
      if (brightness < 0) continue
      const pr = Math.min(255, Math.round(r * brightness))
      const pg = Math.min(255, Math.round(g * brightness))
      const pb = Math.min(255, Math.round(b * brightness))
      gfx.rect(ox + col * scale, oy + row * scale, scale, scale).fill({ color: toHex(pr, pg, pb) })
    }
  }

  const rt = RenderTexture.create({ width: texW, height: texH })
  app.renderer.render({ container: gfx, target: rt })
  gfx.destroy()
  textureCache.set(key, rt)
  return rt
}

// ── Per-agent container ───────────────────────────────────────────────────

interface AgentVisual {
  container: Container
  glowGfx: Graphics
  spriteObj: Sprite
  lastPose: Pose
  lastColor: string
}

export function clearTextureCache(): void {
  textureCache.forEach((rt) => rt.destroy())
  textureCache.clear()
}

export class AgentLayer {
  private container: Container
  private tetherGfx: Graphics
  private visuals: Map<number, AgentVisual> = new Map()
  private app: Application

  constructor(container: Container, app: Application) {
    this.container = container
    this.app = app

    this.tetherGfx = new Graphics()
    container.addChild(this.tetherGfx)
  }

  update(
    entities: AgentEntity[],
    agentMap: Map<number, WireAgent>,
    nowMs: number,
    t: number,
    selectedId?: number,
  ): void {
    const presentIds = new Set(entities.map((e) => e.id))

    // Remove visuals for departed agents
    for (const [id, visual] of this.visuals) {
      if (!presentIds.has(id)) {
        visual.container.destroy({ children: true })
        this.visuals.delete(id)
      }
    }

    // Update tethers
    this.tetherGfx.clear()

    for (const entity of entities) {
      const agent = agentMap.get(entity.id)
      if (!agent) continue

      // Tether from parent to this agent
      if (agent.parent_id !== null) {
        const parentEntity = entities.find((e) => e.id === agent.parent_id)
        if (parentEntity) {
          this.drawTether(parentEntity.pos.x, parentEntity.pos.y, entity.pos.x, entity.pos.y, t)
        }
      }

      // Get or create visual
      let visual = this.visuals.get(entity.id)
      if (!visual) {
        visual = this.createVisual(entity.id)
        this.visuals.set(entity.id, visual)
      }

      // Determine pose and color
      const pose = poseForAgent(agent)
      const [cr, cg, cb] = spriteColor(agent)
      const colorKey = `${cr}:${cg}:${cb}`

      // Update sprite texture if pose or color changed
      if (pose !== visual.lastPose || colorKey !== visual.lastColor) {
        const texture = getSpriteTexture(this.app, pose, cr, cg, cb)
        visual.spriteObj.texture = texture
        visual.lastPose = pose
        visual.lastColor = colorKey
      }

      // Position and scale
      const sw = spriteWidth(SPRITES[pose]) * SPRITE_SCALE
      const sh = spriteHeight(SPRITES[pose]) * SPRITE_SCALE
      const activity = agent.state.type === "Active" ? agent.state.activity : undefined
      const seed = entity.id % 1000
      const bob = bobOffset(agent.state.type, t, seed, activity)

      let visualScale = entity.spawnScale
      if (agent.exiting_at_ms !== null) {
        const elapsed = nowMs - agent.exiting_at_ms
        visualScale = Math.max(0.05, 1 - elapsed / 4500)
      }

      visual.container.x = entity.pos.x
      visual.container.y = entity.pos.y + bob
      visual.container.scale.set(visualScale)
      visual.container.alpha = agent.exiting_at_ms !== null
        ? Math.max(0.05, visualScale)
        : 1

      // Sprite centering (account for outline padding in texture)
      const outlinePad = SPRITE_SCALE
      visual.spriteObj.x = -sw / 2 - outlinePad
      visual.spriteObj.y = -sh / 2 - outlinePad

      // Glow
      visual.glowGfx.clear()
      if (agent.state.type !== "Idle") {
        const isActive = agent.state.type === "Active"
        const pulse = isActive
          ? 0.5 + 0.5 * Math.sin(t * 0.005)
          : 0.3 + 0.3 * Math.sin(t * 0.002)
        const baseR = 16
        const maxR = 26
        const radius = baseR + (maxR - baseR) * pulse
        const alpha = 0.08 + 0.08 * pulse

        // 3 concentric circles for glow effect
        for (let i = 3; i > 0; i--) {
          const r2 = radius * (i / 3) + (3 - i) * 4
          const a2 = alpha * (i / 3)
          visual.glowGfx.circle(0, 0, r2).fill({ color: toHex(cr, cg, cb), alpha: a2 })
        }
      }

      // Selection glow: pulsing orange/yellow ring
      if (entity.id === selectedId) {
        const selPulse = 0.5 + 0.5 * Math.sin(t * 0.006)
        const selRadius = 12 + 4 * selPulse
        const selAlpha = 0.2 + 0.3 * selPulse
        visual.glowGfx.circle(0, 0, selRadius + 4).fill({ color: 0xff8800, alpha: selAlpha * 0.5 })
        visual.glowGfx.circle(0, 0, selRadius + 2).fill({ color: 0xffaa00, alpha: selAlpha * 0.7 })
        visual.glowGfx.circle(0, 0, selRadius).fill({ color: 0xffcc00, alpha: selAlpha })
      }
    }
  }

  private createVisual(_id: number): AgentVisual {
    const c = new Container()
    this.container.addChild(c)

    const glowGfx = new Graphics()
    c.addChild(glowGfx)

    // Placeholder sprite — texture assigned on first update
    const spriteObj = new Sprite()
    spriteObj.eventMode = "static"
    spriteObj.cursor = "pointer"
    c.addChild(spriteObj)

    return { container: c, glowGfx, spriteObj, lastPose: "idle", lastColor: "" }
  }

  private drawTether(x1: number, y1: number, x2: number, y2: number, t: number): void {
    const midY = (y1 + y2) / 2
    const midX = (x1 + x2) / 2

    // Sample bezier curve points
    const steps = 20
    const points: [number, number][] = []
    for (let i = 0; i <= steps; i++) {
      const tStep = i / steps
      const oneMinusT = 1 - tStep
      const bx = oneMinusT * oneMinusT * x1 + 2 * oneMinusT * tStep * midX + tStep * tStep * x2
      const by = oneMinusT * oneMinusT * y1 + 2 * oneMinusT * tStep * midY + tStep * tStep * y2
      points.push([bx, by])
    }

    // Pass 1: outer blue glow (wide, faint)
    this.drawDashedPath(points, 6, 8, (t * 0.03) % 14, 0x0066ff, 4, 0.08)
    // Pass 2: cyan core
    this.drawDashedPath(points, 4, 6, (t * 0.03) % 10, 0x00e5ff, 2, 0.25)
    // Pass 3: yellow data pulse (faster scroll)
    this.drawDashedPath(points, 2, 4, (t * 0.07) % 6, 0xffdd00, 1, 0.15)

    // End terminus: glowing dot
    this.tetherGfx.circle(x2, y2, 4).stroke({ color: 0x00e5ff, width: 1, alpha: 0.6 })
    this.tetherGfx.circle(x2, y2, 2).fill({ color: 0xffffff, alpha: 0.3 })
  }

  private drawDashedPath(
    points: [number, number][],
    dashLen: number,
    gapLen: number,
    offset: number,
    color: number,
    width: number,
    alpha: number,
  ): void {
    const totalDash = dashLen + gapLen
    let dist = -offset
    for (let i = 1; i < points.length; i++) {
      const [px, py] = points[i - 1]
      const [nx, ny] = points[i]
      const segLen = Math.sqrt((nx - px) ** 2 + (ny - py) ** 2)
      const modDist = ((dist % totalDash) + totalDash) % totalDash
      if (modDist < dashLen) {
        this.tetherGfx.moveTo(px, py).lineTo(nx, ny).stroke({ color, width, alpha })
      }
      dist += segLen
    }
  }

  getSprite(agentId: number): Sprite | null {
    return this.visuals.get(agentId)?.spriteObj ?? null
  }

  getContainer(agentId: number): Container | null {
    return this.visuals.get(agentId)?.container ?? null
  }
}
