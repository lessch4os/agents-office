import { Application, Container } from "pixi.js"

export interface OfficeStage {
  app: Application
  layers: {
    background: Container
    floor: Container
    spotlights: Container
    zones: Container
    desks: Container
    decorations: Container
    fxFloor: Container
    agents: Container
    fxAir: Container
    ui: Container
    dragOverlay: Container
  }
}

export async function createOfficeApp(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): Promise<OfficeStage> {
  const app = new Application()
  await app.init({
    canvas,
    width,
    height,
    background: 0x05050f,
    antialias: false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    preference: "webgl",
  })

  const layerNames = [
    "background",
    "floor",
    "spotlights",
    "zones",
    "desks",
    "decorations",
    "fxFloor",
    "agents",
    "fxAir",
    "ui",
    "dragOverlay",
  ] as const

  const containers: Record<string, Container> = {}
  for (const name of layerNames) {
    const c = new Container()
    c.label = name
    app.stage.addChild(c)
    containers[name] = c
  }

  return {
    app,
    layers: containers as OfficeStage["layers"],
  }
}
