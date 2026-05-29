import { Container, Graphics } from "pixi.js"
import { DESK_W, DESK_H, DESK_GAP, COLS } from "../../engine/waypoints"
import type { WireAgent } from "../../types"

export type DeskVariant = "standard" | "wide" | "corner" | "cluttered"

function deskVariant(toolCallCount: number): DeskVariant {
  if (toolCallCount > 100) return "cluttered"
  if (toolCallCount > 50) return "wide"
  if (toolCallCount > 20) return "corner"
  return "standard"
}

function toHex(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}

const SESSION_TINTS: number[] = [
  toHex(68, 255, 68),
  toHex(68, 136, 255),
  toHex(255, 136, 68),
  toHex(136, 68, 255),
  toHex(255, 68, 136),
  toHex(68, 255, 255),
  toHex(255, 255, 68),
  toHex(255, 68, 68),
]

function sessionTint(sessionId: string): number {
  let h = 0
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) | 0
  return SESSION_TINTS[Math.abs(h) % SESSION_TINTS.length]
}

// One permanent Graphics per desk slot. Redrawn each frame to show monitor blink + active state.
export class DeskLayer {
  private container: Container
  private deskGraphics: Map<number, Graphics> = new Map()
  private maxDesks: number = 0

  constructor(container: Container) {
    this.container = container
  }

  update(agents: Record<number, WireAgent>, maxDesks: number, nowMs: number): void {
    if (maxDesks !== this.maxDesks) {
      this.maxDesks = maxDesks
      // Rebuild desk graphics count
      this.deskGraphics.forEach((g) => g.destroy())
      this.deskGraphics.clear()
      this.container.removeChildren()
    }

    const agentByDesk = new Map<number, WireAgent>()
    for (const a of Object.values(agents)) {
      agentByDesk.set(a.desk_index, a)
    }

    for (let idx = 0; idx < maxDesks; idx++) {
      let g = this.deskGraphics.get(idx)
      if (!g) {
        g = new Graphics()
        this.container.addChild(g)
        this.deskGraphics.set(idx, g)
      }
      g.clear()

      const col = idx % COLS
      const row = Math.floor(idx / COLS)
      const x = 40 + col * (DESK_W + DESK_GAP)
      const y = 40 + row * (DESK_H + DESK_GAP)
      const agent = agentByDesk.get(idx) ?? null
      this.drawDesk(g, x, y, agent, nowMs)
    }
  }

  private drawDesk(g: Graphics, x: number, y: number, agent: WireAgent | null, nowMs: number): void {
    const occupied = agent !== null && agent.exiting_at_ms === null
    const variant = agent ? deskVariant(agent.tool_call_count) : "standard"
    const isActive = agent?.state.type === "Active"
    const monitorFlash = isActive && (Math.floor(nowMs / 400) % 2 === 0)

    let dw = DESK_W
    let dh = DESK_H
    let dx = x

    if (variant === "wide") {
      dw = Math.round(DESK_W * 1.25)
      dx = x - (dw - DESK_W) / 2
    }
    if (variant === "corner") {
      dw = Math.round(DESK_W * 0.9)
      dh = Math.round(DESK_H * 0.9)
    }
    if (variant === "cluttered") {
      dh = Math.round(DESK_H * 1.05)
    }

    // Session tint for occupied desks
    const surfaceColor = occupied
      ? (agent ? sessionTint(agent.session_id) : 0x2a2a50)
      : 0x1e1e3a
    const surfaceAlpha = occupied ? 0.15 : 1

    g.rect(dx, y, dw, dh).fill({ color: occupied ? 0x141428 : 0x0c0c1e })
    if (occupied && agent) {
      g.rect(dx, y, dw, dh).fill({ color: surfaceColor, alpha: surfaceAlpha })
    }
    // top bevel
    g.rect(dx, y, dw, 1).fill({ color: 0xffffff, alpha: occupied ? 0.04 : 0.02 })
    // border — cyan glow for active, dark for idle
    g.rect(dx, y, dw, dh).stroke({ color: isActive ? 0x00e5ff : (occupied ? 0x1a1a3a : 0x111122), width: 1, alpha: isActive ? 0.6 : 1.0 })

    if (!occupied || !agent) return

    const cx = dx + dw / 2

    // clutter
    if (variant === "cluttered") {
      g.rect(dx + 4, y + dh - 10, 8, 6).fill({ color: 0xffffff, alpha: 0.04 })
      g.rect(dx + dw - 14, y + dh - 8, 10, 4).fill({ color: 0x6b4c3b })
    }

    // monitor
    const mw = variant === "wide" ? 24 : 18
    const mh = 12
    const mx = cx - mw / 2
    const my = y + 6

    // stand
    g.rect(mx + mw / 2 - 1, my + mh, 2, 4).fill({ color: 0x333333 })
    g.rect(mx + mw / 2 - 4, my + mh + 3, 8, 2).fill({ color: 0x333333 })
    // screen bezel
    g.rect(mx, my, mw, mh).fill({ color: 0x222222 })
    // screen
    g.rect(mx + 2, my + 2, mw - 4, mh - 4).fill({ color: monitorFlash ? 0x003320 : 0x001a0d })
    // monitor scan-lines when active
    if (monitorFlash) {
      for (let i = 0; i < 6; i++) {
        const lx = mx + 3 + ((i * 7) % (mw - 8))
        const ly = my + 3 + ((i * 11) % (mh - 8))
        g.rect(lx, ly, 2, 1).fill({ color: 0x00ff41, alpha: 0.3 })
        g.rect(lx + 1, ly, 1, 1).fill({ color: 0x00ffff, alpha: 0.15 })
      }
    }

    // dual monitor for wide desks
    if (variant === "wide") {
      const m2x = cx + mw / 2 + 4
      g.rect(m2x, my, mw - 4, mh).fill({ color: 0x181820 })
      g.rect(m2x + 2, my + 2, mw - 8, mh - 4).fill({ color: monitorFlash ? 0x001a2a : 0x001a0d })
    }

    // LED
    const ledColor = monitorFlash ? 0x00ff41 : 0x0a1a0f
    g.circle(dx + dw - 6, y + dh - 6, 2).fill({ color: ledColor })
  }
}
