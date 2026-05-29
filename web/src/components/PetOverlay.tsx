import { useRef, useEffect } from "react"
import type { WireScene, WireAgent } from "../types"
import { SPRITES, renderSpriteCentered } from "./sprites"
import type { Pose } from "./sprites"

const FONT_MONO = "'JetBrains Mono', monospace"

const STATE_COLORS: Record<string, [number, number, number]> = {
  Idle: [136, 136, 136],
  Active: [68, 255, 68],
  Waiting: [255, 255, 68],
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

function poseForAgent(a: WireAgent): Pose {
  if (a.state.type === "Active") {
    const activity = (a.state as { activity: string }).activity
    if (activity === "reading") return "reading"
    if (activity === "thinking") return "thinking"
    return "active"
  }
  if (a.state.type === "Waiting") return "waiting"
  return "idle"
}

function spriteColor(a: WireAgent): [number, number, number] {
  if (a.state.type === "Active" && a.current_tool) {
    const tc = TOOL_COLORS[a.current_tool]
    if (tc) {
      const [ar, ag, ab] = STATE_COLORS.Active
      return [
        Math.round(tc[0] * 0.7 + ar * 0.3),
        Math.round(tc[1] * 0.7 + ag * 0.3),
        Math.round(tc[2] * 0.7 + ab * 0.3),
      ]
    }
  }
  return STATE_COLORS[a.state.type] ?? STATE_COLORS.Idle
}

function bobOffset(a: WireAgent, t: number): number {
  const type = a.state.type
  if (type === "Active") {
    const activity = (a.state as { activity: string }).activity
    if (activity === "reading") return Math.sin(t * 0.008) * 1.5
    if (activity === "thinking") return Math.sin(t * 0.0015) * 2.5
    return Math.sin(t * 0.006) * 2
  }
  if (type === "Waiting") return Math.sin(t * 0.002) * 1.5
  return Math.sin(t * 0.003) * 1.5
}

function scaleForAgent(a: WireAgent, nowMs: number): number {
  const age = (nowMs - a.created_at_ms) / 60000
  const growth = 1 + Math.min(a.tool_call_count * 0.15, 2) + Math.min(age * 0.05, 0.5)
  return Math.min(growth, 4)
}

function label(a: WireAgent): string {
  if (a.state.type === "Active" && a.current_tool) {
    const detail = a.state.detail ?? a.current_tool
    return detail.length > 20 ? detail.slice(0, 20) + "\u2026" : detail
  }
  if (a.state.type === "Active" && a.state.detail) {
    return a.state.detail.length > 20 ? a.state.detail.slice(0, 20) + "\u2026" : a.state.detail
  }
  if (a.state.type === "Waiting") return "\u23F3 waiting"
  return "\uD83D\uDCA4 idle"
}

type Props = { scene: WireScene | null }

export function PetOverlay({ scene }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<WireScene | null>(null)
  sceneRef.current = scene

  useEffect(() => {
    let frameId: number

    function draw(t: number) {
      const cvs = canvasRef.current
      if (!cvs) { frameId = requestAnimationFrame(draw); return }
      const ctx = cvs.getContext("2d")
      if (!ctx) { frameId = requestAnimationFrame(draw); return }

      ctx.clearRect(0, 0, cvs.width, cvs.height)

      const s = sceneRef.current
      if (!s) {
        ctx.fillStyle = "#666"
        ctx.font = `14px ${FONT_MONO}`
        ctx.textAlign = "center"
        ctx.fillText("awaiting agents\u2026", cvs.width / 2, cvs.height / 2)
        frameId = requestAnimationFrame(draw)
        return
      }

      const agents = Object.values(s.agents).filter((a) => a.exiting_at_ms == null)
      const spacing = Math.min(80, cvs.width / Math.max(agents.length, 1))
      const sx = spacing / 2 + 20

      for (let i = 0; i < agents.length; i++) {
        const a = agents[i]
        const sc = scaleForAgent(a, s.now_ms)
        const x = sx + i * spacing
        const bob = bobOffset(a, t)
        const y = cvs.height / 2 + bob
        const color = spriteColor(a)
        const [cr, cg, cb] = color
        const pose = poseForAgent(a)

        // glow
        if (a.state.type === "Active") {
          ctx.beginPath()
          ctx.arc(x, y, 12 * sc * 0.5 + 6, 0, Math.PI * 2)
          ctx.fillStyle = "rgba(68,255,68,0.12)"
          ctx.fill()
        }

        // sprite
        const spriteScale = Math.max(0.6, sc * 0.6)
        renderSpriteCentered(ctx, SPRITES[pose], x, y, spriteScale, cr, cg, cb)

        // label below
        ctx.fillStyle = "var(--text-on-surface-bright)"
        ctx.font = `10px ${FONT_MONO}`
        ctx.textAlign = "center"
        ctx.textBaseline = "top"
        const shortLabel = a.label.split("\u00B7")[1] ?? a.label
        ctx.fillText(shortLabel, x, y + 8 * spriteScale + 4)

        ctx.fillStyle = "var(--text-on-surface-muted)"
        ctx.font = `8px ${FONT_MONO}`
        ctx.textBaseline = "top"
        ctx.fillText(label(a), x, y + 8 * spriteScale + 16)
      }

      frameId = requestAnimationFrame(draw)
    }

    frameId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frameId)
  }, [])

  return (
    <div
      style={{
        position: "fixed",
        bottom: 10,
        right: 10,
        zIndex: "var(--z-pet)",
        pointerEvents: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        style={{
          borderRadius: 12,
          background: "var(--bg-glass-tooltip)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      />
    </div>
  )
}
