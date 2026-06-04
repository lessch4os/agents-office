import { Context, Effect, Layer } from "effect"
import type { Db } from "./index"

export class DrizzleClient extends Context.Tag("DrizzleClient")<DrizzleClient, Db>() {}

export function drizzleLayer(db: Db): Layer.Layer<DrizzleClient> {
  return Layer.succeed(DrizzleClient, db)
}

export function withDb<A, E>(effect: Effect.Effect<A, E, DrizzleClient>): Effect.Effect<A, E, DrizzleClient> {
  return effect
}
