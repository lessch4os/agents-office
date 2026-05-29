export const DESK_W = 80
export const DESK_H = 44
export const DESK_GAP = 20
export const COLS = 4
export const SPRITE_SCALE = 2

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export function deskTopLeft(index: number): Point {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  return { x: 40 + col * (DESK_W + DESK_GAP), y: 40 + row * (DESK_H + DESK_GAP) }
}

export function deskCenter(index: number): Point {
  const { x, y } = deskTopLeft(index)
  return { x: x + DESK_W / 2, y: y + DESK_H / 2 - 4 }
}

export interface OfficeZones {
  breakRoom: Rect
  coffee: Point
  whiteboard: Point
  elevator: Point
  front: Point
  serverRack: Point
}

export function computeZones(canvasW: number, canvasH: number): OfficeZones {
  // decorations column x (right side, per computeDecorSpots in Office.tsx):
  const lastX = 40 + (COLS - 1) * (DESK_W + DESK_GAP)
  const decoX = lastX + DESK_W + 14 + 10   // center of 20px deco
  return {
    breakRoom: { x: 50, y: canvasH - 60, w: 120, h: 40 },
    coffee: { x: decoX, y: canvasH - 60 },
    whiteboard: { x: canvasW / 2, y: 20 },
    elevator: { x: canvasW - 20, y: canvasH / 2 },
    front: { x: canvasW / 2, y: canvasH - 20 },
    serverRack: { x: decoX, y: 40 + (DESK_H + DESK_GAP) / 2 },
  }
}

export function randomPointInRect(r: Rect): Point {
  return {
    x: r.x + Math.random() * r.w,
    y: r.y + Math.random() * r.h,
  }
}
