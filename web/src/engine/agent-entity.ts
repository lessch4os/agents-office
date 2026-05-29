import type { Point, OfficeZones } from "./waypoints"
import { deskCenter, randomPointInRect } from "./waypoints"
import { seek, arrive, wander, flee, dist } from "./steering"
import type { Vector } from "./steering"
import type { WireAgent } from "../types"

export type EntityState = "Idle" | "Active" | "Waiting" | "Exiting"

// How long the agent will visit a break room / coffee zone before wandering again.
const ZONE_VISIT_INTERVAL_MIN = 5000
const ZONE_VISIT_INTERVAL_MAX = 15000

export class AgentEntity {
  id: number
  pos: Point
  vel: Vector
  wanderAngle: number
  homeDesk: Point
  state: EntityState = "Idle"
  targetPos: Point | null = null
  // Override target: used for spawn animation or drag
  forcedTarget: Point | null = null
  forcedTargetUntilMs: number = 0
  // Wander zone scheduling
  nextZoneVisitAt: number = 0
  // Spawn grow animation
  spawnScale: number = 1
  spawnStartMs: number = 0
  isNew: boolean = false
  // Sub-agent spawn override (parent walks to whiteboard)
  walkToWhiteboardUntilMs: number = 0
  // Token tracking (for FX)
  prevCacheTokens: number = 0
  prevInputTokens: number = 0

  constructor(agent: WireAgent, nowMs: number) {
    this.id = agent.agent_id
    this.homeDesk = deskCenter(agent.desk_index)
    // Spawn at desk position
    this.pos = { x: this.homeDesk.x, y: this.homeDesk.y }
    this.vel = { x: 0, y: 0 }
    this.wanderAngle = Math.random() * Math.PI * 2
    this.nextZoneVisitAt = nowMs + randomInterval()
    this.spawnStartMs = nowMs
    this.spawnScale = 0
    this.isNew = true
    this.prevCacheTokens = agent.cache_read_tokens
    this.prevInputTokens = agent.context_input_tokens
  }

  get maxSpeed(): number {
    switch (this.state) {
      case "Active": return 2.5
      case "Waiting": return 1.5
      case "Exiting": return 2.0
      default: return 0.8
    }
  }

  get maxForce(): number { return 0.12 }

  update(
    dt: number,
    nowMs: number,
    canvasW: number,
    canvasH: number,
    zones: OfficeZones,
    peers: AgentEntity[],
    sameSessionPeers: AgentEntity[],
  ): void {
    // Grow-in animation (new agent)
    if (this.isNew) {
      const elapsed = nowMs - this.spawnStartMs
      this.spawnScale = Math.min(1, easeOutBack(elapsed / 800))
      if (elapsed >= 800) this.isNew = false
    }

    // Forced target (sub-agent spawn walk, drag release)
    const hasForcedTarget = nowMs < this.forcedTargetUntilMs && this.forcedTarget !== null
    const target = hasForcedTarget ? this.forcedTarget! : this.resolveTarget(nowMs, zones)

    let steer: Vector
    if (hasForcedTarget || this.state === "Active" || this.state === "Waiting" || this.state === "Exiting") {
      steer = arrive(this.pos, target, this.vel, this.maxSpeed, this.maxForce, 40)
    } else {
      // Idle: wander + occasional zone bias
      if (nowMs >= this.nextZoneVisitAt) {
        this.targetPos = pickWanderTarget(zones, canvasW, canvasH)
        this.nextZoneVisitAt = nowMs + randomInterval()
      }
      if (this.targetPos && dist(this.pos, this.targetPos) < 8) {
        this.targetPos = null
      }
      if (this.targetPos) {
        steer = arrive(this.pos, this.targetPos, this.vel, this.maxSpeed * 0.7, this.maxForce)
      } else {
        const w = wander(this.pos, this.vel, this.wanderAngle, this.maxSpeed, this.maxForce, canvasW, canvasH)
        this.wanderAngle = w.newAngle
        steer = w.force
      }
    }

    // Collision avoidance with non-same-session peers
    for (const peer of peers) {
      if (peer.id === this.id) continue
      const d = dist(this.pos, peer.pos)
      if (d < 24 && d > 0) {
        const f = flee(this.pos, peer.pos, this.vel, this.maxSpeed, this.maxForce)
        steer = { x: steer.x + f.x * 0.5, y: steer.y + f.y * 0.5 }
      }
    }

    // Same-session agents: bias toward midpoint (collaboration)
    if (sameSessionPeers.length > 0 && this.state === "Active") {
      const midX = sameSessionPeers.reduce((s, p) => s + p.pos.x, this.pos.x) / (sameSessionPeers.length + 1)
      const midY = sameSessionPeers.reduce((s, p) => s + p.pos.y, this.pos.y) / (sameSessionPeers.length + 1)
      const meetTarget = { x: midX, y: midY }
      if (dist(this.pos, meetTarget) > 30) {
        const f = seek(this.pos, meetTarget, this.vel, this.maxSpeed * 0.4, this.maxForce * 0.3)
        steer = { x: steer.x + f.x, y: steer.y + f.y }
      }
    }

    // Idle attraction: gentle pull toward home desk when not visiting a zone
    if (this.state === "Idle" && !this.targetPos) {
      const homeForce = seek(this.pos, this.homeDesk, this.vel, this.maxSpeed * 0.3, this.maxForce * 0.2)
      steer = { x: steer.x + homeForce.x, y: steer.y + homeForce.y }
    }

    this.vel.x += steer.x * (dt / 16.67)
    this.vel.y += steer.y * (dt / 16.67)

    // Cap speed
    const speed = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y)
    const cap = this.maxSpeed
    if (speed > cap) {
      this.vel.x = (this.vel.x / speed) * cap
      this.vel.y = (this.vel.y / speed) * cap
    }

    this.pos.x += this.vel.x * (dt / 16.67)
    this.pos.y += this.vel.y * (dt / 16.67)

    // Clamp to canvas
    this.pos.x = Math.max(10, Math.min(canvasW - 10, this.pos.x))
    this.pos.y = Math.max(10, Math.min(canvasH - 10, this.pos.y))

    // Hard separation: direct position correction to prevent overlap
    const minDist = 20
    for (const peer of peers) {
      if (peer.id === this.id) continue
      const dx = this.pos.x - peer.pos.x
      const dy = this.pos.y - peer.pos.y
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < minDist && d > 0) {
        const overlap = (minDist - d) * 0.5
        const pushX = (dx / d) * overlap
        const pushY = (dy / d) * overlap
        this.pos.x += pushX
        this.pos.y += pushY
        peer.pos.x -= pushX
        peer.pos.y -= pushY
      }
    }
  }

  private resolveTarget(nowMs: number, zones: OfficeZones): Point {
    switch (this.state) {
      case "Active":
        // If parent, might walk to whiteboard for spawn
        if (nowMs < this.walkToWhiteboardUntilMs) return zones.whiteboard
        return this.homeDesk
      case "Waiting":
        return zones.front
      case "Exiting":
        return zones.elevator
      default:
        return this.targetPos ?? this.homeDesk
    }
  }

  // Called when new child agent is detected: parent walks to whiteboard.
  triggerSpawnWalk(nowMs: number): void {
    this.walkToWhiteboardUntilMs = nowMs + 2500
  }
}

function randomInterval(): number {
  return ZONE_VISIT_INTERVAL_MIN + Math.random() * (ZONE_VISIT_INTERVAL_MAX - ZONE_VISIT_INTERVAL_MIN)
}

function pickWanderTarget(zones: OfficeZones, canvasW: number, canvasH: number): Point {
  const r = Math.random()
  if (r < 0.4) return randomPointInRect(zones.breakRoom)
  if (r < 0.6) return zones.coffee
  // Random spot in canvas interior
  return {
    x: 40 + Math.random() * (canvasW - 80),
    y: 40 + Math.random() * (canvasH - 80),
  }
}

// Overshoot-and-settle easing for spawn grow animation.
function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  const t1 = Math.min(1, t)
  return 1 + c3 * Math.pow(t1 - 1, 3) + c1 * Math.pow(t1 - 1, 2)
}
