import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { AgentsOfficeConfig, AgentsOfficeConfigLive } from "./config"

describe("AgentsOfficeConfig", () => {
  test("default port", async () => {
    const program = Effect.gen(function* () {
      const config = yield* AgentsOfficeConfig
      return config.port
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(AgentsOfficeConfigLive)))
    expect(result).toBe(8080)
  })

  test("default mode is daemon", async () => {
    const program = Effect.gen(function* () {
      const config = yield* AgentsOfficeConfig
      return config.mode
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(AgentsOfficeConfigLive)))
    expect(result).toBe("daemon")
  })

  test("max_desks default", async () => {
    const program = Effect.gen(function* () {
      const config = yield* AgentsOfficeConfig
      return config.maxDesks
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(AgentsOfficeConfigLive)))
    expect(result).toBe(16)
  })
})
