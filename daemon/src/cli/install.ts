import fs from "fs"
import path from "path"

const home = process.env.HOME ?? "/tmp"

function ok(msg: string): void { console.log(`  \u2713 ${msg}`) }
function warn(msg: string): void { console.log(`  \u26A0 ${msg}`) }
function fail(msg: string): void { console.log(`  \u2717 ${msg}`) }

function which(name: string): string | null {
  return Bun.which(name)
}

function pgrep(name: string, exact = true): number | null {
  try {
    const args = exact ? ["pgrep", "-x", name] : ["pgrep", "-f", name]
    const r = Bun.spawnSync(args)
    if (r.exitCode === 0) return parseInt(r.stdout.toString().trim().split("\n")[0]!, 10)
  } catch {}
  return null
}

function getExeDir(): string {
  if (import.meta.dir && !import.meta.dir.startsWith("/$bunfs/")) {
    return path.resolve(import.meta.dir, "../..")
  }
  try {
    const execPath = process.execPath
    if (execPath && fs.existsSync(execPath)) return path.dirname(path.resolve(execPath))
  } catch {}
  try {
    const main = Bun.main as string
    if (main && !main.startsWith("/$bunfs/") && fs.existsSync(main)) return path.dirname(main)
  } catch {}
  return process.cwd()
}

function findSourceDir(): string | null {
  const exeDir = getExeDir()
  const candidates = [
    exeDir,
    path.resolve(process.cwd()),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "daemon"),
  ]
  if (import.meta.dir) {
    candidates.push(path.resolve(import.meta.dir, "../.."))
    candidates.push(path.resolve(import.meta.dir, "../../.."))
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "src", "hook-shim.ts"))) {
      return dir
    }
    if (fs.existsSync(path.join(dir, "daemon", "src", "hook-shim.ts"))) {
      return path.join(dir, "daemon")
    }
  }
  return null
}

function findHookBinary(): string | null {
  const exeDir = getExeDir()
  const srcDir = findSourceDir()
  const candidates = [exeDir, srcDir, path.resolve(process.cwd())].filter(Boolean)
  const seen = new Set<string>()
  for (const dir of candidates) {
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    const p = path.join(dir, "agents-office-hook")
    try { fs.accessSync(p, fs.constants.X_OK); return path.resolve(p) } catch {}
  }
  return null
}

function findPluginDist(): string | null {
  const srcDir = findSourceDir()
  const exeDir = getExeDir()
  const candidates = [
    path.join(srcDir ?? "", "dist", "opencode-plugin.js"),
    path.join(exeDir, "dist", "opencode-plugin.js"),
    path.join(exeDir, "..", "share", "agents-office", "opencode-plugin.js"),
  ].filter(c => c.startsWith("/"))
  for (const c of candidates) {
    try { fs.accessSync(c); return path.resolve(c) } catch {}
  }
  return null
}

function buildHookFromSource(): string | null {
  const srcDir = findSourceDir()
  if (!srcDir) return null
  const srcPath = path.join(srcDir, "src", "hook-shim.ts")
  if (!fs.existsSync(srcPath)) return null
  if (!which("bun")) {
    fail("bun not found — cannot build hook binary")
    return null
  }
  const outfile = path.join(srcDir, "agents-office-hook")
  const r = Bun.spawnSync(["bun", "build", "--compile", "--target=bun", srcPath, "--outfile", outfile])
  if (r.exitCode === 0 && fs.existsSync(outfile)) {
    fs.chmodSync(outfile, 0o755)
    return outfile
  }
  return null
}

function buildPluginFromSource(): string | null {
  const srcDir = findSourceDir()
  if (!srcDir) return null
  const srcPath = path.join(srcDir, "src", "opencode-plugin.ts")
  if (!fs.existsSync(srcPath)) return null
  if (!which("tsc")) {
    fail("tsc not found — cannot build OpenCode plugin")
    return null
  }
  const outDir = path.join(srcDir, "dist")
  fs.mkdirSync(outDir, { recursive: true })
  const outfile = path.join(outDir, "opencode-plugin.js")
  const r = Bun.spawnSync([
    "tsc", srcPath,
    "--outDir", outDir,
    "--module", "esnext",
    "--target", "esnext",
    "--skipLibCheck",
    "--moduleResolution", "bundler",
  ])
  if (r.exitCode === 0 && fs.existsSync(outfile)) return outfile
  return null
}

function patchClaudeSettings(hookPath: string): boolean {
  const settingsPath = `${home}/.claude/settings.json`
  const settingsDir = path.dirname(settingsPath)
  fs.mkdirSync(settingsDir, { recursive: true })

  let cfg: Record<string, unknown> = {}
  if (fs.existsSync(settingsPath)) {
    fs.copyFileSync(settingsPath, `${settingsPath}.bak`)
    try {
      cfg = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
    } catch {
      warn(`invalid JSON in ${settingsPath} — starting fresh (backup saved)`)
      cfg = {}
    }
  }

  const SENTINELS = ["_agents_office", "_ascii_agents"]
  const hookEvents = ["SessionStart", "SessionEnd", "PreToolUse", "PostToolUse", "Notification"]

  let hadAny = false
  const hooks = (cfg.hooks ?? {}) as Record<string, unknown[]>

  for (const event of hookEvents) {
    const entries = (hooks[event] ?? []) as Record<string, unknown>[]
    if (entries.length === 0) continue

    const oldEntries = entries.filter(e => SENTINELS.some(s => e[s] === true))
    const otherEntries = entries.filter(e => !SENTINELS.some(s => e[s] === true))

    const migrated = oldEntries.map(e => {
      for (const s of SENTINELS) delete e[s]
      const hookList = e.hooks as Record<string, unknown>[] | undefined
      if (Array.isArray(hookList)) {
        for (const h of hookList) {
          h.command = hookPath
        }
      }
      e._agents_office = true
      return e
    })

    hooks[event] = [...otherEntries, ...migrated]
    if (migrated.length > 0) hadAny = true
  }

  if (!hadAny) {
    const hookEntry: Record<string, unknown> = {
      _agents_office: true,
      hooks: [{ command: hookPath, type: "command" }],
      matcher: ".*",
    }
    for (const event of hookEvents) {
      hooks[event] = hooks[event] ?? []
      ;(hooks[event] as Record<string, unknown>[]).push({ ...hookEntry })
    }
  }

  cfg.hooks = hooks

  const tmp = `${settingsPath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n")
  fs.renameSync(tmp, settingsPath)
  return true
}

function removeHookEntries(): boolean {
  const settingsPath = `${home}/.claude/settings.json`
  if (!fs.existsSync(settingsPath)) {
    ok("no Claude Code settings to clean")
    return true
  }

  fs.copyFileSync(settingsPath, `${settingsPath}.bak`)

  let cfg: Record<string, unknown>
  try {
    cfg = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
  } catch {
    warn(`invalid JSON in ${settingsPath} — cannot clean hooks`)
    return false
  }

  const SENTINELS = ["_agents_office", "_ascii_agents"]
  const hookEvents = ["SessionStart", "SessionEnd", "PreToolUse", "PostToolUse", "Notification"]
  const hooks = (cfg.hooks ?? {}) as Record<string, unknown[]>

  for (const event of hookEvents) {
    const entries = hooks[event]
    if (!Array.isArray(entries)) continue
    const filtered = entries.filter(e => !SENTINELS.some(s => (e as Record<string, unknown>)[s] === true))
    if (filtered.length > 0) {
      hooks[event] = filtered
    } else {
      delete hooks[event]
    }
  }

  if (Object.keys(hooks).length === 0) {
    delete cfg.hooks
  } else {
    cfg.hooks = hooks
  }

  const tmp = `${settingsPath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n")
  fs.renameSync(tmp, settingsPath)
  return true
}

function installPlugin(pluginPath: string): void {
  const pluginDir = `${home}/.config/opencode/plugins`
  const target = `${pluginDir}/agents-office.js`
  fs.mkdirSync(pluginDir, { recursive: true })

  // Use lstatSync (does not follow symlinks) to detect dangling symlinks
  // that fs.existsSync would miss (e.g. after Homebrew upgrade when old
  // cellar path no longer exists).
  let existing: fs.Stats | undefined
  try { existing = fs.lstatSync(target) } catch {}

  if (existing) {
    if (existing.isSymbolicLink()) {
      fs.unlinkSync(target)
    } else {
      fs.renameSync(target, `${target}.bak`)
    }
    ok(`existing plugin backed up to ${target}.bak`)
  }

  fs.symlinkSync(pluginPath, target)
  ok(`plugin linked: ${pluginPath} → ${target}`)
}

function removePlugin(): boolean {
  const target = `${home}/.config/opencode/plugins/agents-office.js`

  let exists = false
  try { fs.accessSync(target); exists = true } catch {}

  if (!exists) {
    ok("no OpenCode plugin to remove")
    return true
  }

  const bakTarget = `${target}.bak`
  if (fs.existsSync(bakTarget)) {
    try {
      const bakStat = fs.lstatSync(bakTarget)
      if (!bakStat.isSymbolicLink()) {
        fs.rmSync(target, { force: true })
        fs.renameSync(bakTarget, target)
        ok(`restored backup: ${bakTarget} \u2192 ${target}`)
        return true
      }
    } catch {}
  }

  fs.rmSync(target, { force: true })
  ok(`removed plugin: ${target}`)
  return true
}

function warnRunningProcesses(): void {
  const ccPid = pgrep("claude", false)
  if (ccPid !== null) {
    warn("Claude Code is running — hooks won't take effect until restart.")
    console.log("     Run 'agents-office reload' to reload gracefully, then start CC again.")
  }
  const ocPid = pgrep("opencode", false)
  if (ocPid !== null) {
    warn("OpenCode is running — plugin won't take effect until restart.")
    console.log("     Run 'agents-office reload' to reload gracefully, then start OC again.")
  }
}

export function runInstall(args: string[]): void {
  const subcmd = args[0] ?? ""
  const doHooks = subcmd === "" || subcmd === "hooks"
  const doOc = subcmd === "" || subcmd === "opencode"

  if (subcmd !== "" && subcmd !== "hooks" && subcmd !== "opencode") {
    console.log(`Unknown target: "${subcmd}". Use "hooks", "opencode", or no argument for both.`)
    process.exit(1)
  }

  let exitCode = 0

  if (doHooks) {
    console.log("Hooks:")
    let hookPath = findHookBinary()
    if (hookPath) {
      ok(`hook binary found: ${hookPath}`)
    } else {
      console.log("  building hook from source...")
      hookPath = buildHookFromSource()
      if (hookPath) {
        ok(`hook binary built: ${hookPath}`)
      } else {
        fail("could not find or build hook binary.\n    Install bun and run from the agents-office source directory, or\n    place a pre-built agents-office-hook binary next to agents-office.")
        exitCode = 1
      }
    }

    if (hookPath) {
      if (patchClaudeSettings(hookPath)) {
        ok(`hook entries written to ${home}/.claude/settings.json\n    Backup: ${home}/.claude/settings.json.bak`)
      }
    }
    console.log("")
  }

  if (doOc) {
    console.log("OpenCode plugin:")
    let pluginPath = findPluginDist()
    if (pluginPath) {
      ok(`plugin dist found: ${pluginPath}`)
    } else {
      console.log("  building plugin from source...")
      pluginPath = buildPluginFromSource()
      if (pluginPath) {
        ok(`plugin built: ${pluginPath}`)
      } else {
        fail("could not find or build OpenCode plugin.\n    Install tsc (TypeScript) and run from the agents-office source directory, or\n    place a pre-built dist/opencode-plugin.js next to agents-office.")
        exitCode = 1
      }
    }

    if (pluginPath) {
      installPlugin(pluginPath)
    }
    console.log("")
  }

  if (exitCode === 0) {
    warnRunningProcesses()
    ok("install complete")
  }
  process.exitCode = exitCode
}

export function runUninstall(args: string[]): void {
  const subcmd = args[0] ?? ""
  const doHooks = subcmd === "" || subcmd === "hooks"
  const doOc = subcmd === "" || subcmd === "opencode"

  if (subcmd !== "" && subcmd !== "hooks" && subcmd !== "opencode") {
    console.log(`Unknown target: "${subcmd}". Use "hooks", "opencode", or no argument for both.`)
    process.exit(1)
  }

  if (doHooks) {
    console.log("Hooks:")
    if (removeHookEntries()) {
      ok("agents-office hook entries removed from Claude Code settings")
    }
    console.log("")
  }

  if (doOc) {
    console.log("OpenCode plugin:")
    removePlugin()
    console.log("")
  }

  warnRunningProcesses()
  ok("uninstall complete")
}
