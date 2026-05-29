import { Container, Graphics, Text, TextStyle } from "pixi.js"
import type { AgentEntity } from "../../engine/agent-entity"
import type { WireAgent } from "../../types"
import { SPRITES, spriteHeight } from "../sprites"
import { SPRITE_SCALE } from "../../engine/waypoints"
import { computeCostUsd } from "../../pricing"

// ── Speech bubble state ───────────────────────────────────────────────────

export interface SpeechBubble {
  agentId: number
  lines: string[]
  createdAt: number
  duration: number
  cx: number
  cy: number
}

export function createSpeechBubble(
  agentId: number,
  lines: string[],
  cx: number,
  cy: number,
  nowMs: number,
): SpeechBubble {
  return { agentId, lines: lines.slice(0, 3), createdAt: nowMs, duration: 3000, cx, cy }
}

export function deriveBubbleLines(
  stateType: string,
  currentTool: string | null,
  detail: string | null,
  reason?: string,
): string[] {
  if (stateType === "Active") {
    if (detail) return [detail.length > 30 ? detail.slice(0, 30) + "…" : detail]
    if (currentTool) return [currentTool]
    return ["working…"]
  }
  if (stateType === "Waiting") return ["⏳ " + (reason ?? "waiting")]
  return []
}

// ── UILayer ───────────────────────────────────────────────────────────────

const NAMEPLATE_STYLE = new TextStyle({ fontSize: 9, fontFamily: "monospace", fill: "#00e5ff" })
const CHIP_STYLE = new TextStyle({ fontSize: 8, fontFamily: "monospace", fill: "#00ff41" })
const BUBBLE_LINE_STYLE = new TextStyle({ fontSize: 9, fontFamily: "monospace", fill: "#00e5ff" })
const COST_STYLE = new TextStyle({ fontSize: 11, fontFamily: "monospace", fill: "#ffdd00", fontWeight: "bold" })
const TOOL_PROJ_STYLE = new TextStyle({ fontSize: 8, fontFamily: "monospace", fill: "#00e5ff" })

function toHex(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}

interface NameplateVisual {
  label: Text
  chip: Text
  bg: Graphics
  costText: Text
  toolText: Text
}

export class UILayer {
  private container: Container
  private nameplates: Map<number, NameplateVisual> = new Map()
  private bubbleGfx: Graphics
  private bubbleTexts: Map<number, Text[]> = new Map()
  private contextBarsGfx: Graphics
  private statsText: Text

  constructor(container: Container) {
    this.container = container

    this.contextBarsGfx = new Graphics()
    container.addChild(this.contextBarsGfx)

    this.bubbleGfx = new Graphics()
    container.addChild(this.bubbleGfx)

    this.statsText = new Text({
      text: "",
      style: new TextStyle({ fontSize: 11, fontFamily: "monospace", fill: "#556677" }),
    })
    this.statsText.x = 8
    container.addChild(this.statsText)
  }

  update(
    entities: AgentEntity[],
    agentMap: Map<number, WireAgent>,
    bubbles: Map<number, SpeechBubble>,
    nowMs: number,
    canvasH: number,
  ): void {
    const presentIds = new Set(entities.map((e) => e.id))

    // Remove departed nameplates
    for (const [id, np] of this.nameplates) {
      if (!presentIds.has(id)) {
        np.bg.destroy()
        np.label.destroy()
        np.chip.destroy()
        np.costText.destroy()
        np.toolText.destroy()
        this.nameplates.delete(id)
        this.bubbleTexts.get(id)?.forEach((t) => t.destroy())
        this.bubbleTexts.delete(id)
      }
    }

    // Update or create nameplates
    for (const entity of entities) {
      const agent = agentMap.get(entity.id)
      if (!agent || agent.exiting_at_ms !== null) continue

      let np = this.nameplates.get(entity.id)
      if (!np) {
        const bg = new Graphics()
        const label = new Text({ text: "", style: NAMEPLATE_STYLE })
        const chip = new Text({ text: "", style: CHIP_STYLE })
        const costText = new Text({ text: "", style: COST_STYLE })
        const toolText = new Text({ text: "", style: TOOL_PROJ_STYLE })
        this.container.addChild(bg)
        this.container.addChild(label)
        this.container.addChild(chip)
        this.container.addChild(costText)
        this.container.addChild(toolText)
        np = { bg, label, chip, costText, toolText }
        this.nameplates.set(entity.id, np)
      }

      const pose = "idle" as const
      const sh = spriteHeight(SPRITES[pose]) * SPRITE_SCALE
      const nameplateY = entity.pos.y + sh / 2 + 4

      const labelStr = (agent.label ?? "").split(" · ")[0] || agent.label || "?"
      const chipStr = String(agent.tool_call_count)

      np.label.text = labelStr
      np.chip.text = `[${chipStr}]`

      const lw = np.label.width
      const badgeW = Math.max(lw + 16, 50)
      const badgeH = 16
      const bx = entity.pos.x - badgeW / 2
      const by = nameplateY

      // Nameplate — solid dark pod with cyan border for readability over checkerboard
      np.bg.clear()
      np.bg.roundRect(bx, by, badgeW, badgeH, 4).fill({ color: 0x0a0e17, alpha: 0.92 })
      np.bg.roundRect(bx, by, badgeW, badgeH, 4).stroke({ color: 0x00e5ff, width: 1, alpha: 0.5 })

      // Tool count chip — no background, just text to right
      const chipX = bx + badgeW + 4
      np.chip.x = chipX
      np.chip.y = by + 4

      np.label.x = entity.pos.x - lw / 2
      np.label.y = by + 3

      // Floating cost/tool projection above desk
      const isActive = agent.state.type === "Active"
      const seed = entity.id % 1000
      const yBob = Math.sin(nowMs * 0.002 + seed * 2.3) * 2
      const projY = entity.pos.y - 36 + yBob

      if (isActive) {
        const costUsd = agent.token_input_total > 0
          ? computeCostUsd(agent.model_name, agent.token_input_total, agent.token_output_total, agent.cache_read_tokens)
          : 0
        np.costText.text = costUsd > 0 ? `$${costUsd.toFixed(4)}` : ""
        np.costText.x = entity.pos.x - np.costText.width / 2
        np.costText.y = projY - 12
        np.costText.alpha = 0.9

        const toolName = agent.state.type === "Active" && agent.current_tool ? agent.current_tool : ""
        np.toolText.text = toolName
        np.toolText.x = entity.pos.x - np.toolText.width / 2
        np.toolText.y = projY
        np.toolText.alpha = 0.7

        // Dark pods behind floating labels so grid lines don't bleed through
        if (toolName) {
          const tw = np.toolText.width
          np.bg.roundRect(entity.pos.x - tw / 2 - 4, projY - 2, tw + 8, 12, 2)
            .fill({ color: 0x0a0e17, alpha: 0.85 })
        }
        const cw = np.costText.width
        if (cw > 0) {
          np.bg.roundRect(entity.pos.x - cw / 2 - 4, projY - 14, cw + 8, 12, 2)
            .fill({ color: 0x0a0e17, alpha: 0.85 })
        }
      } else {
        np.costText.text = ""
        np.toolText.text = ""
      }
    }

    // Context bars
    this.contextBarsGfx.clear()
    for (const entity of entities) {
      const agent = agentMap.get(entity.id)
      if (!agent || agent.exiting_at_ms !== null || agent.context_window_limit <= 0) continue

      const pose = "idle" as const
      const sh = spriteHeight(SPRITES[pose]) * SPRITE_SCALE
      const barY = entity.pos.y + sh / 2 + 22

      const barW = 36
      const inPct = Math.min(1, agent.context_input_tokens / agent.context_window_limit)
      const outPct = Math.min(1, agent.token_output_total / agent.context_window_limit)
      const cx = entity.pos.x

      this.contextBarsGfx.roundRect(cx - barW / 2, barY, barW, 4, 2).fill({ color: 0x222222 })

      const barColor = inPct > 0.8
        ? toHex(255, 136, 68)
        : inPct > 0.6
          ? toHex(255, 255, 68)
          : toHex(0, 255, 65)
      if (inPct > 0) {
        this.contextBarsGfx.roundRect(cx - barW / 2, barY, barW * inPct, 4, 2).fill({ color: barColor })
      }
      if (outPct > 0) {
        this.contextBarsGfx.roundRect(cx - barW / 2, barY + 6, barW * outPct, 3, 1.5).fill({ color: 0x00ffff, alpha: 0.6 })
      }
    }

    // Speech bubbles
    this.bubbleGfx.clear()
    for (const [agentId, bubble] of bubbles) {
      const age = nowMs - bubble.createdAt
      if (age >= bubble.duration) continue
      const opacity = age < bubble.duration * 0.85
        ? 1
        : Math.max(0, 1 - (age - bubble.duration * 0.85) / (bubble.duration * 0.15))

      const entity = entities.find((e) => e.id === agentId)
      const bx_anchor = entity ? entity.pos.x : bubble.cx
      const by_anchor = entity ? entity.pos.y - 20 : bubble.cy

      const lineH = 12
      const maxW = Math.max(40, ...bubble.lines.map((l) => l.length * 6))
      const bw = maxW + 14
      const bh = bubble.lines.length * lineH + 10
      const floatY = by_anchor - 28 - Math.min(age * 0.005, 16)
      const bx = bx_anchor - bw / 2
      const by = floatY - bh

      this.bubbleGfx.roundRect(bx, by, bw, bh, 6).fill({ color: 0x060618, alpha: 0.92 * opacity })
      this.bubbleGfx.roundRect(bx, by, bw, bh, 6).stroke({ color: 0x00e5ff, width: 1, alpha: 0.3 * opacity })

      // tail
      this.bubbleGfx.moveTo(bx_anchor - 4, by + bh)
        .lineTo(bx_anchor + 4, by + bh)
        .lineTo(bx_anchor, by + bh + 6)
        .closePath()
        .fill({ color: 0x060618, alpha: 0.92 * opacity })

      // Update text objects
      let textObjs = this.bubbleTexts.get(agentId)
      if (!textObjs || textObjs.length !== bubble.lines.length) {
        textObjs?.forEach((t) => t.destroy())
        textObjs = bubble.lines.map(() => {
          const t = new Text({ text: "", style: BUBBLE_LINE_STYLE })
          this.container.addChild(t)
          return t
        })
        this.bubbleTexts.set(agentId, textObjs)
      }
      for (let i = 0; i < bubble.lines.length; i++) {
        const t = textObjs[i]
        t.text = bubble.lines[i]
        t.alpha = opacity
        t.x = bx_anchor - t.width / 2
        t.y = by + 6 + lineH * i
      }
    }

    // Clean up bubble texts for expired bubbles
    for (const [id, texts] of this.bubbleTexts) {
      if (!bubbles.has(id)) {
        texts.forEach((t) => t.destroy())
        this.bubbleTexts.delete(id)
      }
    }

    // Stats
    this.statsText.text = `${entities.length} agent${entities.length !== 1 ? "s" : ""}`
    this.statsText.y = canvasH - 20
  }
}
