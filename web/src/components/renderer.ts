const _rgbCache = new Map<string, string>()
function rgbKey(r: number, g: number, b: number, a: number = 1): string {
  const kr = Math.max(0, Math.min(255, Math.round(r)))
  const kg = Math.max(0, Math.min(255, Math.round(g)))
  const kb = Math.max(0, Math.min(255, Math.round(b)))
  const key = `${kr},${kg},${kb},${a}`
  let v = _rgbCache.get(key)
  if (!v) {
    v = a >= 1 ? `rgb(${kr},${kg},${kb})` : `rgba(${kr},${kg},${kb},${a})`
    _rgbCache.set(key, v)
  }
  return v
}

export function rgb(r: number, g: number, b: number): string {
  return rgbKey(r, g, b, 1)
}

export function rgba(r: number, g: number, b: number, a: number): string {
  return rgbKey(r, g, b, a)
}

// ── Types ──

export type Zone = {
  label: string
  color: [number, number, number]
  x: number
  y: number
  w: number
  h: number
}

export type SpeechBubble = {
  agentId: number
  lines: string[]
  createdAt: number
  duration: number
  cx: number
  cy: number
}

export type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  life: number
  maxLife: number
}

export type ElevatorState = {
  doorOpen: number
  carY: number
  targetCarY: number
}

export type DeskVariant = "standard" | "wide" | "corner" | "cluttered"

// ── Floor ──

export function drawFloor(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const tileS = 24
  const cols = Math.ceil(w / tileS)
  const rows = Math.ceil(h / tileS)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dark = (r + c) % 2 === 0
      ctx.fillStyle = dark ? "#0d0d1e" : "#0f0f24"
      ctx.fillRect(c * tileS, r * tileS, tileS, tileS)
    }
  }
}

// ── Zone signage ──

export function drawZoneSign(
  ctx: CanvasRenderingContext2D,
  zone: Zone,
) {
  const px = zone.x
  const py = zone.y

  // zone floor tint
  ctx.fillStyle = rgba(zone.color[0], zone.color[1], zone.color[2], 0.04)
  ctx.fillRect(px, py, zone.w, zone.h)

  // top divider line
  ctx.fillStyle = rgba(zone.color[0], zone.color[1], zone.color[2], 0.15)
  ctx.fillRect(px, py, zone.w, 1)

  // label banner
  const bw = ctx.measureText(zone.label).width + 20
  const bh = 18
  ctx.fillStyle = rgba(zone.color[0], zone.color[1], zone.color[2], 0.2)
  ctx.beginPath()
  ctx.roundRect(px + 8, py - bh / 2, bw, bh, 4)
  ctx.fill()
  ctx.fillStyle = rgb(zone.color[0], zone.color[1], zone.color[2])
  ctx.font = "9px monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(zone.label, px + 8 + bw / 2, py)
}

export function computeZones(
  agents: Array<{ desk_index: number; source: string }>,
  cols: number,
  deskW: number,
  deskH: number,
  deskGap: number,
  margin: number,
): Zone[] {
  const sourceColors: Record<string, [number, number, number]> = {
    "claude-code": [68, 255, 68],
    "antigravity": [136, 68, 255],
    "opencode": [68, 136, 255],
  }
  const zones = new Map<string, Zone>()
  for (const a of agents) {
    const col = a.desk_index % cols
    const row = Math.floor(a.desk_index / cols)
    const x = margin + col * (deskW + deskGap)
    const y = margin + row * (deskH + deskGap)
    const color = sourceColors[a.source] ?? [100, 100, 100]
    const label = a.source === "claude-code" ? "Claude Code" : a.source === "antigravity" ? "Antigravity" : a.source === "opencode" ? "OpenCode" : a.source
    const existing = zones.get(a.source)
    if (existing) {
      existing.x = Math.min(existing.x, x)
      existing.y = Math.min(existing.y, y)
      existing.w = Math.max(existing.w, x + deskW - existing.x)
      existing.h = Math.max(existing.h, y + deskH - existing.y)
    } else {
      zones.set(a.source, { label, color, x, y, w: deskW, h: deskH })
    }
  }
  return [...zones.values()].map((z) => ({ ...z, w: z.w + 16, h: z.h + 16 }))
}

// ── Desk ──

export function drawDesk(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: {
    occupied: boolean
    exiting: boolean
    hasMonitorFlash: boolean
    tint: string | null
    variant: DeskVariant
    toolCallCount: number
  },
) {
  const { occupied, hasMonitorFlash, tint, variant, toolCallCount } = opts

  let dw = w
  let dh = h
  let dx = x
  let dy = y

  if (variant === "wide") {
    dw = Math.round(w * 1.25)
    dx = x - (dw - w) / 2
  }
  if (variant === "corner") {
    dw = Math.round(w * 0.9)
    dh = Math.round(h * 0.9)
  }
  if (variant === "cluttered") {
    dh = Math.round(h * 1.05)
  }

  // desk surface
  ctx.fillStyle = occupied ? "#2a2a50" : "#1e1e3a"
  if (tint && occupied) ctx.fillStyle = tint
  ctx.fillRect(dx, dy, dw, dh)

  // top bevel
  ctx.fillStyle = occupied ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)"
  ctx.fillRect(dx, dy, dw, 1)

  // border
  ctx.strokeStyle = occupied ? "#4a4a72" : "#2a2a4a"
  ctx.lineWidth = 1
  ctx.strokeRect(dx, dy, dw, dh)

  if (!occupied) return

  const cx = dx + dw / 2

  // clutter items
  if (variant === "cluttered") {
    ctx.fillStyle = "rgba(255,255,255,0.04)"
    ctx.fillRect(dx + 4, dy + dh - 10, 8, 6)
    ctx.fillStyle = "#6b4c3b"
    ctx.fillRect(dx + dw - 14, dy + dh - 8, 10, 4)
  }
  if (toolCallCount > 50) {
    ctx.fillStyle = "rgba(68,255,68,0.06)"
    ctx.fillRect(dx + dw - 20, dy + 2, 18, 4)
    ctx.fillStyle = "#4f4"
    ctx.font = "5px monospace"
    ctx.textAlign = "right"
    ctx.fillText(`${Math.min(toolCallCount, 99)}`, dx + dw - 3, dy + 6)
  }

  // monitor
  const mw = variant === "wide" ? 24 : 18
  const mh = 12
  const mx = cx - mw / 2
  const my = dy + 6

  ctx.fillStyle = "#333"
  ctx.fillRect(mx + mw / 2 - 1, my + mh, 2, 4)
  ctx.fillRect(mx + mw / 2 - 4, my + mh + 3, 8, 2)

  ctx.fillStyle = "#222"
  ctx.fillRect(mx, my, mw, mh)

  ctx.fillStyle = hasMonitorFlash ? "#0a2a0a" : "#0a1a0a"
  ctx.fillRect(mx + 2, my + 2, mw - 4, mh - 4)

  if (hasMonitorFlash) {
    ctx.fillStyle = "rgba(68,255,68,0.3)"
    for (let i = 0; i < 6; i++) {
      const dx2 = mx + 3 + ((i * 7) % (mw - 8))
      const dy2 = my + 3 + ((i * 11) % (mh - 8))
      ctx.fillRect(dx2, dy2, 2, 1)
    }
  }

  // dual monitor for wide desks
  if (variant === "wide") {
    const m2x = cx + mw / 2 + 4
    ctx.fillStyle = "#222"
    ctx.fillRect(m2x, my, mw - 4, mh)
    ctx.fillStyle = "#0a1a0a"
    ctx.fillRect(m2x + 2, my + 2, mw - 8, mh - 4)
    if (hasMonitorFlash) {
      ctx.fillStyle = "rgba(68,136,255,0.2)"
      ctx.fillRect(m2x + 3, my + 3, 3, 2)
    }
  }

  // status LED
  const ledR = 2
  ctx.beginPath()
  ctx.arc(dx + dw - 6, dy + dh - 6, ledR, 0, Math.PI * 2)
  ctx.fillStyle = hasMonitorFlash ? "#4f4" : "#444"
  ctx.fill()
}

// ── Glow ──

export function drawGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pulse: number,
  color: [number, number, number],
  active: boolean,
) {
  if (!active) return
  const [r, g, b] = color
  const baseR = 16
  const maxR = 26
  const radius = baseR + (maxR - baseR) * pulse
  const alpha = 0.1 + 0.1 * pulse

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)

  const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius)
  grad.addColorStop(0, rgba(r, g, b, alpha + 0.05))
  grad.addColorStop(1, rgba(r, g, b, 0))
  ctx.fillStyle = grad
  ctx.fill()
}

// ── Speech bubble ──

export function createSpeechBubble(
  agentId: number,
  lines: string[],
  cx: number,
  cy: number,
  now: number,
): SpeechBubble {
  return {
    agentId,
    lines: lines.slice(0, 3),
    createdAt: now,
    duration: 3000,
    cx,
    cy,
  }
}

export function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  bubble: SpeechBubble,
  now: number,
) {
  const age = now - bubble.createdAt
  const opacity = age < bubble.duration * 0.85
    ? 1
    : Math.max(0, 1 - (age - bubble.duration * 0.85) / (bubble.duration * 0.15))
  if (opacity <= 0) return

  ctx.font = "9px monospace"
  const lineH = 12
  const maxW = Math.max(
    40,
    ...bubble.lines.map((l) => ctx.measureText(l).width),
  )
  const bw = maxW + 14
  const bh = bubble.lines.length * lineH + 10
  const floatY = bubble.cy - 28 - Math.min(age * 0.005, 16)
  const bx = bubble.cx - bw / 2
  const by = floatY - bh

  // bubble bg
  ctx.fillStyle = rgba(25, 25, 50, 0.92 * opacity)
  ctx.beginPath()
  ctx.roundRect(bx, by, bw, bh, 6)
  ctx.fill()

  // border
  ctx.strokeStyle = rgba(100, 100, 180, 0.3 * opacity)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(bx, by, bw, bh, 6)
  ctx.stroke()

  // tail
  ctx.beginPath()
  ctx.moveTo(bubble.cx - 4, by + bh)
  ctx.lineTo(bubble.cx + 4, by + bh)
  ctx.lineTo(bubble.cx, by + bh + 6)
  ctx.closePath()
  ctx.fillStyle = rgba(25, 25, 50, 0.92 * opacity)
  ctx.fill()
  ctx.strokeStyle = rgba(100, 100, 180, 0.3 * opacity)
  ctx.lineWidth = 1
  ctx.stroke()

  // text
  ctx.fillStyle = rgba(200, 200, 220, opacity)
  ctx.font = "9px monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  for (let i = 0; i < bubble.lines.length; i++) {
    ctx.fillText(bubble.lines[i], bubble.cx, by + 6 + lineH * i + lineH / 2)
  }
}

export function deriveBubbleLines(
  stateType: string,
  currentTool: string | null,
  detail: string | null,
  reason?: string,
): string[] {
  if (stateType === "Active") {
    if (detail) return [detail.length > 30 ? detail.slice(0, 30) + "\u2026" : detail]
    if (currentTool) return [currentTool]
    return ["working\u2026"]
  }
  if (stateType === "Waiting") return ["\u23F3 " + (reason ?? "waiting")]
  return []
}

// ── Delegation line ──

export function drawDelegationLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashOffset: number,
) {
  const midY = (y1 + y2) / 2
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.quadraticCurveTo(x1, midY, (x1 + x2) / 2, midY)
  ctx.quadraticCurveTo(x2, midY, x2, y2)
  ctx.setLineDash([4, 6])
  ctx.lineDashOffset = dashOffset
  ctx.strokeStyle = "rgba(255,255,255,0.1)"
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.setLineDash([])

  ctx.beginPath()
  ctx.arc(x2, y2, 2, 0, Math.PI * 2)
  ctx.fillStyle = "rgba(255,255,255,0.2)"
  ctx.fill()
}

// ── Nameplate ──

export function drawNameplate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  label: string,
  toolCount: number,
  exiting: boolean,
) {
  if (exiting) return
  const text = label
  ctx.font = "10px monospace"
  const textW = ctx.measureText(text).width
  const badgeW = Math.max(textW + 16, 50)
  const badgeH = 16
  const bx = cx - badgeW / 2
  const by = y + 2

  ctx.fillStyle = "rgba(0,0,0,0.5)"
  ctx.beginPath()
  ctx.roundRect(bx, by, badgeW, badgeH, 4)
  ctx.fill()

  ctx.strokeStyle = "rgba(255,255,255,0.1)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(bx, by, badgeW, badgeH, 4)
  ctx.stroke()

  ctx.fillStyle = "#ccc"
  ctx.font = "10px monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, cx, by + badgeH / 2)

  const chipW = ctx.measureText(String(toolCount)).width + 10
  const chipX = bx + badgeW + 4
  ctx.fillStyle = "rgba(255,255,255,0.06)"
  ctx.beginPath()
  ctx.roundRect(chipX, by, chipW, badgeH, 4)
  ctx.fill()

  ctx.fillStyle = "#aaa"
  ctx.font = "9px monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(String(toolCount), chipX + chipW / 2, by + badgeH / 2)
}

// ── Context bar ──

export function drawContextBar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  inputTokens: number,
  outputTokens: number,
  limit: number,
) {
  if (limit <= 0) return
  const barW = 36
  const inPct = Math.min(1, inputTokens / limit)
  const outPct = Math.min(1, outputTokens / limit)

  ctx.fillStyle = "#222"
  ctx.beginPath()
  ctx.roundRect(cx - barW / 2, y, barW, 4, 2)
  ctx.fill()

  ctx.fillStyle = inPct > 0.8 ? rgb(255, 136, 68) : inPct > 0.6 ? rgb(255, 255, 68) : rgb(68, 255, 68)
  ctx.beginPath()
  ctx.roundRect(cx - barW / 2, y, barW * inPct, 4, 2)
  ctx.fill()

  if (outputTokens > 0) {
    ctx.fillStyle = "rgba(68,255,255,0.6)"
    ctx.beginPath()
    ctx.roundRect(cx - barW / 2, y + 6, barW * outPct, 3, 1.5)
    ctx.fill()
  }
}

// ── Tool effects (ripple + spark burst) ──

const ripples: Array<{
  cx: number
  cy: number
  startTime: number
  duration: number
  color: [number, number, number]
}> = []

type Spark = { vx: number; vy: number; life: number }
const sparkBursts: Array<{
  x: number
  y: number
  startTime: number
  duration: number
  color: [number, number, number]
  sparks: Spark[]
}> = []

export function spawnToolEffect(cx: number, cy: number, color: [number, number, number]) {
  ripples.push({ cx, cy, startTime: performance.now(), duration: 700, color })

  const count = 8 + Math.floor(Math.random() * 5)
  const sparks: Spark[] = []
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5
    const speed = 1 + Math.random() * 2
    sparks.push({
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
    })
  }
  sparkBursts.push({
    x: cx,
    y: cy,
    startTime: performance.now(),
    duration: 500,
    color,
    sparks,
  })
}

export function drawToolEffects(ctx: CanvasRenderingContext2D, now: number) {
  // draw ripples
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i]
    const elapsed = now - r.startTime
    if (elapsed >= r.duration) {
      ripples.splice(i, 1)
      continue
    }
    const progress = elapsed / r.duration
    const radius = 10 + 30 * progress
    const alpha = (1 - progress) * 0.4
    const [cr, cg, cb] = r.color

    ctx.beginPath()
    ctx.arc(r.cx, r.cy, radius, 0, Math.PI * 2)
    ctx.strokeStyle = rgba(cr, cg, cb, alpha)
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // draw spark bursts
  for (let i = sparkBursts.length - 1; i >= 0; i--) {
    const sb = sparkBursts[i]
    const elapsed = now - sb.startTime
    if (elapsed >= sb.duration) {
      sparkBursts.splice(i, 1)
      continue
    }
    const progress = elapsed / sb.duration
    const [cr, cg, cb] = sb.color
    for (const sp of sb.sparks) {
      sp.life = 1 - progress
      const sx = sb.x + sp.vx * progress * 40
      const sy = sb.y + sp.vy * progress * 40 + progress * progress * 20
      ctx.fillStyle = rgba(cr, cg, cb, sp.life * 0.6)
      ctx.fillRect(sx, sy, 2, 2)
    }
  }
}

// ── Particle system ──

export function createParticles(
  count: number,
  canvasW: number,
  canvasH: number,
  speed: number,
): Particle[] {
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
      maxLife: 1,
    })
  }
  return particles
}

export function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
) {
  for (const p of particles) {
    if (p.life <= 0) continue
    ctx.fillStyle = rgba(100, 100, 180, p.alpha * p.life)
    ctx.fillRect(p.x, p.y, p.size, p.size)
  }
}

export function tickParticles(
  particles: Particle[],
  dt: number,
  canvasW: number,
  canvasH: number,
) {
  for (const p of particles) {
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.life -= dt * 0.02
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

// ── Elevator ──

export function createElevatorState(): ElevatorState {
  return { doorOpen: 0, carY: 0, targetCarY: 0 }
}

export function tickElevator(e: ElevatorState, dt: number) {
  e.doorOpen += (Math.random() > 0.99 ? 1 : -1) * dt * 0.3
  e.doorOpen = Math.max(0, Math.min(1, e.doorOpen))
  e.carY += (e.targetCarY - e.carY) * dt * 0.5
}

export function drawElevator(
  ctx: CanvasRenderingContext2D,
  e: ElevatorState,
  shaftX: number,
  canvasH: number,
) {
  const shaftW = 36
  const sx = shaftX

  ctx.fillStyle = "#0a0a15"
  ctx.fillRect(sx, 0, shaftW, canvasH)

  ctx.strokeStyle = "#1a1a2a"
  ctx.lineWidth = 1
  ctx.strokeRect(sx, 0, shaftW, canvasH)

  // rails
  ctx.fillStyle = "#15152a"
  ctx.fillRect(sx + 4, 0, 2, canvasH)
  ctx.fillRect(sx + shaftW - 6, 0, 2, canvasH)

  // car
  const carH = 80
  const carY = e.carY
  ctx.fillStyle = "#1a1a30"
  ctx.fillRect(sx + 2, carY, shaftW - 4, carH)

  // door
  const doorW = shaftW - 12
  const doorGap = e.doorOpen * (doorW / 2 - 1)
  const doorH = carH - 6
  const doorX = sx + 6
  const doorY = carY + 3

  ctx.fillStyle = "#222"
  ctx.fillRect(doorX, doorY, doorW / 2 - doorGap, doorH)
  ctx.fillRect(doorX + doorW / 2 + doorGap, doorY, doorW / 2 - doorGap, doorH)

  ctx.strokeStyle = "#333"
  ctx.lineWidth = 1
  ctx.strokeRect(doorX, doorY, doorW / 2 - doorGap, doorH)
  ctx.strokeRect(doorX + doorW / 2 + doorGap, doorY, doorW / 2 - doorGap, doorH)

  // floor indicator
  ctx.fillStyle = "#333"
  ctx.fillRect(sx + shaftW / 2 - 8, 6, 16, 10)
  ctx.fillStyle = "#4f4"
  ctx.font = "7px monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(`G`, sx + shaftW / 2, 11)
}

// ── Decoration ──

export function drawDecorItem(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.save()
  ctx.translate(x, y)

  switch (kind) {
    case "plant": {
      ctx.fillStyle = "#6b4c3b"
      ctx.fillRect(w / 2 - 5, h - 8, 10, 8)
      ctx.fillStyle = "#5a3d2e"
      ctx.fillRect(w / 2 - 6, h - 5, 12, 2)
      ctx.fillStyle = "#3a7a3a"
      ctx.beginPath()
      ctx.arc(w / 2, h - 12, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#4a9a4a"
      ctx.beginPath()
      ctx.arc(w / 2, h - 14, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#5aba5a"
      ctx.beginPath()
      ctx.arc(w / 2, h - 16, 2, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case "water": {
      ctx.fillStyle = "#445"
      ctx.fillRect(w / 2 - 5, h - 6, 10, 6)
      ctx.fillStyle = "#556"
      ctx.fillRect(w / 2 - 3, h - 16, 6, 10)
      ctx.fillStyle = "#778"
      ctx.fillRect(w / 2 - 3, h - 18, 6, 3)
      ctx.fillStyle = "rgba(68,136,255,0.4)"
      ctx.fillRect(w / 2 - 2, h - 13, 4, 5)
      ctx.fillStyle = "#88a"
      ctx.fillRect(w / 2 - 1, h - 4, 2, 2)
      break
    }
    case "server": {
      ctx.fillStyle = "#1a1a2a"
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = "#2a2a4a"
      ctx.lineWidth = 1
      ctx.strokeRect(0, 0, w, h)
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = "#222"
        ctx.fillRect(2, 2 + i * (h / 3), w - 4, h / 3 - 3)
        ctx.fillStyle = i % 2 === 0 ? "#4f4" : "#f44"
        ctx.beginPath()
        ctx.arc(w - 6, 4 + i * (h / 3) + h / 6, 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
  }
  ctx.restore()
}
