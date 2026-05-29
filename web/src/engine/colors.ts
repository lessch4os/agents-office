// PixiJS 0xRRGGBB color constants matching the V2-inspired palette
// These map to the CSS custom properties in tokens.css for cross-platform consistency.

export const COLORS = {
  // Backgrounds
  CANVAS: 0x121318,
  SURFACE_DARK: 0x0a0a1a,
  SURFACE: 0x0f0f24,
  SURFACE_LIGHT: 0x1a1a2a,
  SURFACE_ELEVATED: 0x1e1e3a,
  SURFACE_GLASS: 0x0a0e17,

  // Primary (green)
  PRIMARY: 0x00ff41,
  PRIMARY_DIM: 0x00e55b,
  PRIMARY_DARK: 0x003320,
  PRIMARY_BG: 0x001a0d,

  // Secondary (cyan)
  SECONDARY: 0x00e5ff,
  SECONDARY_DIM: 0x00daf3,
  SECONDARY_DARK: 0x001133,
  SECONDARY_BG: 0x001a2a,

  // Tertiary (amber)
  TERTIARY: 0xe5c500,
  TERTIARY_DIM: 0xffdd00,
  TERTIARY_BG: 0x332a00,

  // Error (red)
  ERROR: 0xff4d4d,
  ERROR_DIM: 0xf44,
  ERROR_BG: 0x330a0a,

  // Neutral surfaces
  NEUTRAL_900: 0x05050f,
  NEUTRAL_800: 0x0a0a18,
  NEUTRAL_700: 0x0d0d20,
  NEUTRAL_600: 0x111122,
  NEUTRAL_500: 0x181820,
  NEUTRAL_400: 0x222222,
  NEUTRAL_300: 0x333333,
  NEUTRAL_200: 0x444444,

  // Desk variants (session tints)
  DESK_TINTS: [
    0x00ff41,  // green
    0x4488ff,  // blue
    0xff8844,  // orange
    0x8844ff,  // purple
    0xff44ff,  // pink
    0x44ffff,  // cyan
    0xffff44,  // yellow
    0xff4444,  // red
  ],

  // Effects
  GLOW_BASE: 0x00e55b,
  TETHER_GLOW: 0x0066ff,
  TETHER_CORE: 0x00e5ff,
  TETHER_PULSE: 0xffdd00,
  SPOTLIGHT: 0x1a3020,
  BEVEL: 0xffffff,
  MONITOR_BEZEL: 0x222222,
  MONITOR_SCREEN_ACTIVE: 0x00ff41,
  MONITOR_SCAN_LINE: 0x00ffff,
  SERVER_LED_ON: 0x00ff41,
  SERVER_LED_ALT: 0xff8800,
  CONVEYOR: 0x0a0a1a,
  CONVEYOR_TICK: 0x001a2a,
  ELEVATOR_SHAFT: 0x030309,
  ELEVATOR_RAIL: 0x001a2a,
  ELEVATOR_CAR: 0x0a0a20,
  ELEVATOR_DOOR: 0x0d0d1a,
  ELEVATOR_INDICATOR: 0x00ff41,

  // Zone source colors (RGB tuples for alpha blending)
  SOURCE_CC: [0, 255, 65] as const,
  SOURCE_AG: [136, 68, 255] as const,
  SOURCE_OC: [68, 136, 255] as const,
  STATE_IDLE: [40, 40, 60] as const,
  STATE_ACTIVE: [0, 255, 65] as const,
  STATE_WAITING: [0, 220, 255] as const,

  // Tool colors (RGB tuples)
  TOOL_BASH: [255, 136, 68] as const,
  TOOL_READ: [136, 68, 255] as const,
  TOOL_WRITE: [0, 255, 65] as const,
  TOOL_EDIT: [68, 136, 255] as const,
  TOOL_GLOB: [255, 68, 255] as const,
  TOOL_AGENT: [255, 255, 68] as const,
  TOOL_TASK: [255, 255, 68] as const,
} as const

export function toHex(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}
