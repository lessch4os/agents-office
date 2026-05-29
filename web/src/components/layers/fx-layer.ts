import { Container, Graphics } from "pixi.js"
import { COLS, DESK_W, DESK_GAP } from "../../engine/waypoints"

function toHex(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}

// ── Effect types ──────────────────────────────────────────────────────────

interface Ripple {
  cx: number; cy: number; startMs: number; duration: number; color: [number, number, number]
}

interface Spark {
  vx: number; vy: number; life: number
}

interface SparkBurst {
  x: number; y: number; startMs: number; duration: number
  color: [number, number, number]; sparks: Spark[]
}

interface TokenPulse {
  cx: number; cy: number; startMs: number
}

interface Lightning {
  x1: number; y1: number; x2: number; y2: number
  startMs: number; segments: Array<[number, number]>
}

interface PortalParticle {
  vx: number; vy: number; startMs: number; duration: number; color: [number, number, number]
}

interface PortalBurst {
  x: number; y: number; startMs: number
  particles: PortalParticle[]
}

interface Particle {
  x: number; y: number
  vx: number; vy: number
  size: number; alpha: number; life: number
}

// ── Commit box ────────────────────────────────────────────────────────────

interface CommitBox {
  x: number; y: number; startMs: number; beltY: number
}

// ── FxLayer ───────────────────────────────────────────────────────────────

export class FxLayer {
  private floorGfx: Graphics
  private airGfx: Graphics
  private conduitGfx: Graphics
  private canvasW: number
  private canvasH: number

  private ripples: Ripple[] = []
  private sparkBursts: SparkBurst[] = []
  private tokenPulses: TokenPulse[] = []
  private lightnings: Lightning[] = []
  private portalBursts: PortalBurst[] = []
  private commitBoxes: CommitBox[] = []

  private floorParticles: Particle[] = []
  private airParticles: Particle[] = []

  constructor(floorContainer: Container, airContainer: Container, canvasW: number, canvasH: number) {
    this.canvasW = canvasW
    this.canvasH = canvasH

    this.conduitGfx = new Graphics()
    floorContainer.addChild(this.conduitGfx)

    this.floorGfx = new Graphics()
    floorContainer.addChild(this.floorGfx)

    this.airGfx = new Graphics()
    airContainer.addChild(this.airGfx)

    this.floorParticles = createParticles(30, canvasW, canvasH, 0.3)
    this.airParticles = createParticles(20, canvasW, canvasH, 0.15)
  }

  spawnToolEffect(cx: number, cy: number, color: [number, number, number]): void {
    this.ripples.push({ cx, cy, startMs: performance.now(), duration: 700, color })
    const count = 8 + Math.floor(Math.random() * 5)
    const sparks: Spark[] = []
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5
      const speed = 1 + Math.random() * 2
      sparks.push({ vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1 })
    }
    this.sparkBursts.push({ x: cx, y: cy, startMs: performance.now(), duration: 500, color, sparks })
  }

  spawnTokenPulse(cx: number, cy: number): void {
    this.tokenPulses.push({ cx, cy, startMs: performance.now() })
  }

  spawnLightning(x1: number, y1: number, x2: number, y2: number): void {
    const segments: Array<[number, number]> = [[x1, y1]]
    const steps = 8
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      const bx = x1 + (x2 - x1) * t + (Math.random() - 0.5) * 18
      const by = y1 + (y2 - y1) * t + (Math.random() - 0.5) * 18
      segments.push([bx, by])
    }
    segments.push([x2, y2])
    this.lightnings.push({ x1, y1, x2, y2, startMs: performance.now(), segments })
  }

  spawnPortalBurst(x: number, y: number): void {
    const particles: PortalParticle[] = []
    for (let i = 0; i < 16; i++) {
      const angle = (Math.PI * 2 * i) / 16
      const speed = 1.5 + Math.random() * 2
      const greenShade: [number, number, number] = [
        Math.round(0 + Math.random() * 20),
        Math.round(200 + Math.random() * 55),
        Math.round(200 + Math.random() * 55),
      ]
      particles.push({
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        startMs: performance.now(),
        duration: 800 + Math.random() * 400,
        color: greenShade,
      })
    }
    this.portalBursts.push({ x, y, startMs: performance.now(), particles })
  }

  spawnCommitBox(cx: number, beltY: number): void {
    this.commitBoxes.push({ x: cx, y: beltY - 10, startMs: performance.now(), beltY })
  }

  update(dt: number, nowMs: number, canvasW: number, canvasH: number): void {
    tickParticles(this.floorParticles, dt, canvasW, canvasH)
    tickParticles(this.airParticles, dt, canvasW, canvasH)

    // Pulsing conduit lines along desk grid boundaries
    this.conduitGfx.clear()
    const phase = nowMs * 0.001
    const alphaA = 0.01 + 0.01 * Math.sin(phase)
    const alphaB = 0.03 + 0.02 * Math.sin(phase)
    const alphaC = 0.07 + 0.03 * Math.sin(phase)
    const margin = 40
    // Vertical conduits at column boundaries
    for (let col = 0; col <= COLS; col++) {
      const cx = margin + col * (DESK_W + DESK_GAP) - DESK_GAP / 2
      this.conduitGfx.moveTo(cx, 0).lineTo(cx, this.canvasH).stroke({ color: 0x00e5ff, width: 4, alpha: alphaA })
      this.conduitGfx.moveTo(cx, 0).lineTo(cx, this.canvasH).stroke({ color: 0x00e5ff, width: 2, alpha: alphaB })
      this.conduitGfx.moveTo(cx, 0).lineTo(cx, this.canvasH).stroke({ color: 0x00e5ff, width: 1, alpha: alphaC })
    }
    // Horizontal conduits at row boundaries (estimated from canvas height)
    const tileS = 24
    for (let ry = 0; ry < this.canvasH; ry += tileS * 4) {
      this.conduitGfx.moveTo(0, ry).lineTo(this.canvasW, ry).stroke({ color: 0x0066ff, width: 2, alpha: alphaA })
      this.conduitGfx.moveTo(0, ry).lineTo(this.canvasW, ry).stroke({ color: 0x0066ff, width: 1, alpha: alphaB })
    }

    this.floorGfx.clear()
    this.airGfx.clear()

    // floor particles
    drawParticleSet(this.floorGfx, this.floorParticles)

    // ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]
      const elapsed = nowMs - r.startMs
      if (elapsed >= r.duration) { this.ripples.splice(i, 1); continue }
      const progress = elapsed / r.duration
      const radius = 10 + 30 * progress
      const alpha = (1 - progress) * 0.4
      const [cr, cg, cb] = r.color
      this.floorGfx.circle(r.cx, r.cy, radius).stroke({ color: toHex(cr, cg, cb), width: 2, alpha })
    }

    // spark bursts
    for (let i = this.sparkBursts.length - 1; i >= 0; i--) {
      const sb = this.sparkBursts[i]
      const elapsed = nowMs - sb.startMs
      if (elapsed >= sb.duration) { this.sparkBursts.splice(i, 1); continue }
      const progress = elapsed / sb.duration
      const [cr, cg, cb] = sb.color
      for (const sp of sb.sparks) {
        const sx = sb.x + sp.vx * progress * 40
        const sy = sb.y + sp.vy * progress * 40 + progress * progress * 20
        this.floorGfx.rect(sx, sy, 2, 2).fill({ color: toHex(cr, cg, cb), alpha: (1 - progress) * 0.6 })
      }
    }

    // token pulses (yellow expanding ring)
    for (let i = this.tokenPulses.length - 1; i >= 0; i--) {
      const tp = this.tokenPulses[i]
      const elapsed = nowMs - tp.startMs
      if (elapsed >= 600) { this.tokenPulses.splice(i, 1); continue }
      const progress = elapsed / 600
      const radius = 10 + 40 * progress
      const alpha = (1 - progress) * 0.5
      this.airGfx.circle(tp.cx, tp.cy, radius).stroke({ color: 0xffdc32, width: 2, alpha })
      this.airGfx.circle(tp.cx, tp.cy, radius * 0.6).stroke({ color: 0xffdc32, width: 1, alpha: alpha * 0.5 })
    }

    // lightning bolts (cache hit)
    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      const bolt = this.lightnings[i]
      const elapsed = nowMs - bolt.startMs
      if (elapsed >= 400) { this.lightnings.splice(i, 1); continue }
      const alpha = Math.max(0, 1 - elapsed / 400)
      for (let j = 1; j < bolt.segments.length; j++) {
        const [ax, ay] = bolt.segments[j - 1]
        const [bx, by] = bolt.segments[j]
        this.airGfx.moveTo(ax, ay).lineTo(bx, by).stroke({ color: 0x88ddff, width: 2, alpha })
        this.airGfx.moveTo(ax, ay).lineTo(bx, by).stroke({ color: 0xffffff, width: 1, alpha: alpha * 0.5 })
      }
    }

    // portal bursts (sub-agent spawn)
    for (let i = this.portalBursts.length - 1; i >= 0; i--) {
      const pb = this.portalBursts[i]
      let anyAlive = false
      for (const p of pb.particles) {
        const pe = nowMs - p.startMs
        if (pe >= p.duration) continue
        anyAlive = true
        const progress = pe / p.duration
        const px2 = pb.x + p.vx * progress * 50
        const py2 = pb.y + p.vy * progress * 50
        const alpha = (1 - progress) * 0.8
        const [cr, cg, cb] = p.color
        this.airGfx.circle(px2, py2, 3 * (1 - progress)).fill({ color: toHex(cr, cg, cb), alpha })
      }
      if (!anyAlive) this.portalBursts.splice(i, 1)
    }

    // commit boxes
    for (let i = this.commitBoxes.length - 1; i >= 0; i--) {
      const cb = this.commitBoxes[i]
      const elapsed = nowMs - cb.startMs
      if (elapsed >= 1500) { this.commitBoxes.splice(i, 1); continue }
      const progress = elapsed / 1500
      const bx = cb.x + progress * 200
      const alpha = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3
      this.floorGfx.rect(bx, cb.beltY - 6, 12, 8).fill({ color: 0x00ff41, alpha: alpha * 0.8 })
      this.floorGfx.rect(bx, cb.beltY - 6, 12, 8).stroke({ color: 0x00e5ff, width: 1, alpha })
    }

    // air particles
    drawParticleSet(this.airGfx, this.airParticles)
  }
}

// ── Particle helpers ──────────────────────────────────────────────────────

function createParticles(count: number, canvasW: number, canvasH: number, speed: number): Particle[] {
  const particles: Particle[] = []
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * canvasW,
      y: Math.random() * canvasH,
      vx: (Math.random() - 0.5) * speed,
      vy: (Math.random() - 0.5) * speed * 0.3,
      size: 1 + Math.random() * 2,
      alpha: 0.05 + Math.random() * 0.1,
      life: 1,
    })
  }
  return particles
}

function tickParticles(particles: Particle[], dt: number, canvasW: number, canvasH: number): void {
  for (const p of particles) {
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.life -= dt * 0.002
    if (p.life <= 0) {
      p.x = Math.random() * canvasW
      p.y = Math.random() * canvasH
      p.life = 1
    }
    if (p.x < 0) p.x += canvasW
    if (p.x > canvasW) p.x -= canvasW
    if (p.y < 0) p.y += canvasH
    if (p.y > canvasH) p.y -= canvasH
  }
}

function drawParticleSet(g: Graphics, particles: Particle[]): void {
  for (const p of particles) {
    if (p.life <= 0) continue
    g.rect(p.x, p.y, p.size, p.size).fill({ color: 0x003366, alpha: p.alpha * p.life })
  }
}

// ── Elevator ─────────────────────────────────────────────────────────────

export interface ElevatorState {
  doorOpen: number
  carY: number
  targetCarY: number
}

export function createElevatorState(): ElevatorState {
  return { doorOpen: 0, carY: 0, targetCarY: 0 }
}

export function tickElevator(e: ElevatorState, dt: number): void {
  e.doorOpen += (Math.random() > 0.99 ? 1 : -1) * dt * 0.003
  e.doorOpen = Math.max(0, Math.min(1, e.doorOpen))
  e.carY += (e.targetCarY - e.carY) * dt * 0.005
}

export function drawElevator(
  g: Graphics,
  e: ElevatorState,
  shaftX: number,
  canvasH: number,
  nowMs: number,
): void {
  const shaftW = 36
  g.rect(shaftX, 0, shaftW, canvasH).fill({ color: 0x030309 })
  g.rect(shaftX, 0, shaftW, canvasH).stroke({ color: 0x001133, width: 1 })

  // rails
  g.rect(shaftX + 4, 0, 2, canvasH).fill({ color: 0x001a2a })
  g.rect(shaftX + shaftW - 6, 0, 2, canvasH).fill({ color: 0x001a2a })

  // car
  const carH = 80
  const carY = e.carY
  g.rect(shaftX + 2, carY, shaftW - 4, carH).fill({ color: 0x0a0a20 })

  // door
  const doorW = shaftW - 12
  const doorGap = Math.round(e.doorOpen * (doorW / 2 - 1))
  const doorH = carH - 6
  const doorX = shaftX + 6
  const doorY = carY + 3

  g.rect(doorX, doorY, doorW / 2 - doorGap, doorH).fill({ color: 0x0d0d1a })
  g.rect(doorX + doorW / 2 + doorGap, doorY, doorW / 2 - doorGap, doorH).fill({ color: 0x0d0d1a })
  g.rect(doorX, doorY, doorW / 2 - doorGap, doorH).stroke({ color: 0x00e5ff, width: 1, alpha: 0.3 })
  g.rect(doorX + doorW / 2 + doorGap, doorY, doorW / 2 - doorGap, doorH).stroke({ color: 0x00e5ff, width: 1, alpha: 0.3 })

  // floor indicator — electric green blink
  const indicatorColor = Math.floor(nowMs / 500) % 2 === 0 ? 0x00ff41 : 0x004410
  g.rect(shaftX + shaftW / 2 - 8, 6, 16, 10).fill({ color: indicatorColor })
}
