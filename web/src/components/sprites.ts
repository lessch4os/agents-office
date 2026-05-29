export type SpriteCell = number // -1 = transparent, 0-1 = brightness multiplier
export type Sprite = SpriteCell[][]

function parseSprite(rows: string[]): Sprite {
  const B: Record<string, number> = {
    "1": 0.3,
    "2": 0.5,
    "3": 0.7,
    "4": 0.85,
    "5": 0.95,
  }
  return rows.map((r) => [...r].map((ch) => B[ch] ?? -1))
}

export type Pose = "idle" | "active" | "waiting" | "reading" | "thinking"

export const SPRITES: Record<Pose, Sprite> = {
  idle: parseSprite([
    "............",
    ".....22.....",
    "....2332....",
    "....2222....",
    "...222222...",
    "..22.33.22..",
    "..22222222..",
    "...222222...",
    "2222222222..",
    "22222222....",
    "...22..22...",
    "...22..22...",
    "...22..22...",
    "..222..222..",
    "............",
    "............",
  ]),

  active: parseSprite([
    "............",
    "....2222....",
    "...244442...",
    "..22555222..",
    "..22555222..",
    "...223322...",
    ".2233333322.",
    "223333333322",
    ".2233333322.",
    "22..2222..22",
    "2.2.2222.2.2",
    ".2..2222..2.",
    "2...2222...2",
    "....2222....",
    "....2..2....",
    "............",
  ]),

  waiting: parseSprite([
    "............",
    "....2222....",
    "...233332...",
    "..2233332...",
    "..22333322..",
    "..22333322..",
    "..2222222...",
    "..22222222..",
    ".22.2222.22.",
    ".22.2222.22.",
    ".22.2222.22.",
    "...22..22...",
    "...22..22...",
    "..11....11..",
    "..11....11..",
    "............",
  ]),

  // both arms forward on desk (reading/scanning files)
  reading: parseSprite([
    "............",
    "....2222....",
    "...233332...",
    "...233332...",
    "..22333322..",
    "..22333322..",
    "...222222...",
    "..22222222..",
    "2222222222..",
    "2222222222..",
    "22..22222222",
    "...22..22...",
    "...22..22...",
    "..11....11..",
    "..11....11..",
    "............",
  ]),

  // left arm raised to chin (thinking/contemplating)
  thinking: parseSprite([
    "............",
    "....2222....",
    "...233332...",
    "..2233332...",
    "2222333322..",
    "2222333322..",
    ".222222222..",
    "..22222222..",
    "..2.2222.22.",
    "..2.2222.22.",
    "..2.2222.22.",
    "...22..22...",
    "...22..22...",
    "..11....11..",
    "..11....11..",
    "............",
  ]),
}

const DECO_PLANT = parseSprite([
  "............",
  "......44....",
  ".....344....",
  "....3334....",
  "...33334....",
  "..333334....",
  "....2222....",
  "...222222...",
  "...222222...",
  "...22..22...",
])

const DECO_WATER = parseSprite([
  "............",
  "....2222....",
  "...233332...",
  "...244442...",
  "...244442...",
  "...233332...",
  "...233332...",
  "....2222....",
  "...233332...",
  "............",
])

const DECO_SERVER = parseSprite([
  "............",
  "...111111...",
  "...151151...",
  "...111111...",
  "...151151...",
  "...111111...",
  "...151151...",
  "...111111...",
  "...111111...",
  "............",
])

export type DecoKind = "plant" | "water" | "server"

export const DECOS: Record<DecoKind, Sprite> = {
  plant: DECO_PLANT,
  water: DECO_WATER,
  server: DECO_SERVER,
}

export function spriteWidth(s: Sprite): number {
  return s[0]?.length ?? 0
}

export function spriteHeight(s: Sprite): number {
  return s.length
}

const _rgbCache = new Map<string, string>()
function rgbKey(r: number, g: number, b: number, a: number = 1): string {
  const kr = Math.round(r)
  const kg = Math.round(g)
  const kb = Math.round(b)
  const key = `${kr},${kg},${kb},${a}`
  let v = _rgbCache.get(key)
  if (!v) {
    v = a === 1 ? `rgb(${kr},${kg},${kb})` : `rgba(${kr},${kg},${kb},${a})`
    _rgbCache.set(key, v)
  }
  return v
}

export function renderSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  x: number,
  y: number,
  scale: number,
  tintR: number,
  tintG: number,
  tintB: number,
) {
  const h = sprite.length
  const w = sprite[0]?.length ?? 0

  // Outline pass: render black at edge pixel neighbors
  const outlineNeighbors: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  ctx.fillStyle = "#666"
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (sprite[row][col] < 0) continue
      for (const [dc, dr] of outlineNeighbors) {
        const nc = col + dc
        const nr = row + dr
        if (nc < 0 || nc >= w || nr < 0 || nr >= h || sprite[nr][nc] < 0) {
          ctx.fillRect(x + nc * scale, y + nr * scale, scale, scale)
        }
      }
    }
  }

  // Color pass: render colored pixels on top (overwrites interior outlines)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const b = sprite[row][col]
      if (b < 0) continue
      ctx.fillStyle = rgbKey(tintR * b, tintG * b, tintB * b)
      ctx.fillRect(x + col * scale, y + row * scale, scale, scale)
    }
  }
}

export function renderSpriteCentered(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  cx: number,
  cy: number,
  scale: number,
  tintR: number,
  tintG: number,
  tintB: number,
) {
  const w = sprite[0]?.length ?? 0
  const h = sprite.length
  renderSprite(ctx, sprite, cx - (w * scale) / 2, cy - (h * scale) / 2, scale, tintR, tintG, tintB)
}

export function renderDecoration(
  ctx: CanvasRenderingContext2D,
  kind: DecoKind,
  x: number,
  y: number,
  scale: number,
) {
  const sprite = DECOS[kind]
  renderSprite(ctx, sprite, x, y, scale, 200, 200, 200)
}
