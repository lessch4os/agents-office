import { Container, Graphics, Text, TextStyle } from "pixi.js"
import { COLS, DESK_W, DESK_H, DESK_GAP } from "../../engine/waypoints"

function toHex(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}

// Drawn once — static checkerboard with obsidian bevel tiles.
export function buildFloor(container: Container, w: number, h: number): void {
  const g = new Graphics()
  const tileS = 24
  const cols = Math.ceil(w / tileS) + 1
  const rows = Math.ceil(h / tileS) + 1
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dark = (r + c) % 2 === 0
      const tx = c * tileS
      const ty = r * tileS
      g.rect(tx, ty, tileS, tileS).fill({ color: dark ? 0x060612 : 0x0a0a1a })
      // bevel: lighter top-left edge, darker bottom-right
      g.rect(tx, ty, tileS, 1).fill({ color: 0x0f0f24, alpha: 0.5 })
      g.rect(tx, ty, 1, tileS).fill({ color: 0x0f0f24, alpha: 0.3 })
      g.rect(tx, ty + tileS - 1, tileS, 1).fill({ color: 0x030309, alpha: 0.6 })
      g.rect(tx + tileS - 1, ty, 1, tileS).fill({ color: 0x030309, alpha: 0.4 })
    }
  }
  container.addChild(g)
}

export interface ZoneData {
  source: string
  desk_index: number
}

const SOURCE_COLORS: Record<string, [number, number, number]> = {
  "claude-code": [0, 255, 65],
  "antigravity": [136, 68, 255],
  "opencode": [68, 136, 255],
}

const SOURCE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  "antigravity": "Antigravity",
  "opencode": "OpenCode",
}

// Redrawn when agent list changes.
export function rebuildZones(container: Container, agents: ZoneData[], margin = 40): void {
  container.removeChildren()

  const zoneMap = new Map<string, { x: number; y: number; w: number; h: number; color: [number, number, number]; label: string }>()

  for (const a of agents) {
    const col = a.desk_index % COLS
    const row = Math.floor(a.desk_index / COLS)
    const x = margin + col * (DESK_W + DESK_GAP)
    const y = margin + row * (DESK_H + DESK_GAP)
    const color = SOURCE_COLORS[a.source] ?? ([100, 100, 100] as [number, number, number])
    const label = SOURCE_LABELS[a.source] ?? a.source
    const existing = zoneMap.get(a.source)
    if (existing) {
      existing.x = Math.min(existing.x, x)
      existing.y = Math.min(existing.y, y)
      existing.w = Math.max(existing.w, x + DESK_W - existing.x)
      existing.h = Math.max(existing.h, y + DESK_H - existing.y)
    } else {
      zoneMap.set(a.source, { label, color, x, y, w: DESK_W, h: DESK_H })
    }
  }

  for (const zone of zoneMap.values()) {
    const [r, g, b] = zone.color
    const hex = toHex(r, g, b)
    const zw = zone.w + 16
    const zh = zone.h + 16

    const gfx = new Graphics()
    gfx.rect(zone.x, zone.y, zw, zh).fill({ color: hex, alpha: 0.04 })
    // conduit-style zone divider in cyan instead of source color
    gfx.rect(zone.x, zone.y, zw, 1).fill({ color: 0x00e5ff, alpha: 0.2 })
    container.addChild(gfx)

    const labelText = new Text({
      text: zone.label,
      style: new TextStyle({ fontSize: 9, fontFamily: "monospace", fill: "#00e5ff" }),
    })
    labelText.x = zone.x + 10
    labelText.y = zone.y + 2
    container.addChild(labelText)
  }
}
