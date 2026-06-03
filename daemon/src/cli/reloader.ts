export async function runReload(args: string[]): Promise<void> {
  const onlyDaemon = args.includes("--daemon-only")
  const onlyAgents = args.includes("--agents-only")
  const actions: string[] = []
  const warnings: string[] = []

  function findPids(pattern: string): number[] {
    try {
      const r = Bun.spawnSync(["pgrep", "-f", pattern])
      if (r.exitCode === 0) return r.stdout.toString().trim().split("\n").filter(Boolean).map(Number)
    } catch {}
    return []
  }

  function signalProcess(pid: number, signal: string): boolean {
    const r = Bun.spawnSync(["kill", `-${signal}`, String(pid)])
    return r.exitCode === 0
  }

  async function waitForExit(pids: number[], timeoutMs: number): Promise<number[]> {
    const remaining: number[] = []
    const deadline = Date.now() + timeoutMs
    for (const pid of pids) {
      while (Date.now() < deadline) {
        const r = Bun.spawnSync(["kill", "-0", String(pid)])
        if (r.exitCode !== 0) break
        await new Promise((r) => setTimeout(r, 200))
      }
      if (Bun.spawnSync(["kill", "-0", String(pid)]).exitCode === 0) remaining.push(pid)
    }
    return remaining
  }

  if (!onlyDaemon) {
    const ccPids = findPids("claude")
    if (ccPids.length > 0) {
      console.log(`  sending SIGINT to Claude Code (${ccPids.join(", ")})...`)
      for (const pid of ccPids) signalProcess(pid, "INT")
      const stuck = await waitForExit(ccPids, 3000)
      if (stuck.length > 0) {
        console.log(`  \u26A0 ${stuck.length} Claude Code process(es) did not exit`)
        for (const pid of stuck) console.log(`       run: kill -9 ${pid}`)
      } else console.log(`  \u2713 Claude Code exited gracefully`)
      actions.push("claude-code")
    } else console.log(`  \u2014 Claude Code not running`)

    const ocPids = findPids("opencode")
    if (ocPids.length > 0) {
      console.log(`  sending SIGINT to OpenCode (${ocPids.join(", ")})...`)
      for (const pid of ocPids) signalProcess(pid, "INT")
      const stuck = await waitForExit(ocPids, 3000)
      if (stuck.length > 0) console.log(`  \u26A0 ${stuck.length} OpenCode process(es) did not exit`)
      else console.log(`  \u2713 OpenCode exited gracefully`)
      actions.push("opencode")
    } else console.log(`  \u2014 OpenCode not running`)
  }

  if (!onlyAgents) {
    const isSystemd = (() => {
      try { return Bun.spawnSync(["systemctl", "is-active", "agents-office"]).stdout.toString().trim() === "active" } catch { return false }
    })()
    if (isSystemd) {
      console.log(`  restarting systemd service...`)
      if (Bun.spawnSync(["sudo", "systemctl", "restart", "agents-office"]).exitCode === 0) console.log(`  \u2713 daemon restarted (systemd)`)
      else { console.log(`  \u2717 daemon restart failed (systemd)`); warnings.push("daemon-restart") }
      actions.push("daemon")
    } else {
      const agentPids = findPids("agents-office")
      if (agentPids.length > 0) {
        console.log(`  sending SIGHUP to agents-office (${agentPids.join(", ")})...`)
        for (const pid of agentPids) signalProcess(pid, "HUP")
        await new Promise((r) => setTimeout(r, 1000))
        if (findPids("agents-office").length === 0) { console.log(`  \u26A0 daemon exited on HUP — re-start it manually`); warnings.push("daemon-restart") }
        else console.log(`  \u2713 daemon reloaded`)
      } else console.log(`  \u2014 daemon not running`)
      actions.push("daemon")
    }
  }

  if (actions.length === 0 && !onlyDaemon && !onlyAgents) { console.log(`  nothing to reload`); return }
  console.log(`\n  reloaded: ${actions.map((a) => `\u2713 ${a}`).join(", ")}`)
  if (warnings.length > 0) { console.log(`  \u26A0 ${warnings.length} warning(s)`); process.exitCode = 1 }
}
