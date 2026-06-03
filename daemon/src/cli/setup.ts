import fs from "fs"
import path from "path"
import readline from "readline"

function rl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout })
}

function ask(question: string, defaultVal = ""): Promise<string> {
  const r = rl()
  return new Promise((resolve) => {
    r.question(defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `, (answer) => {
      r.close()
      resolve(answer.trim() || defaultVal)
    })
  })
}

function askPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    Bun.spawnSync(["stty", "-echo"])
    const r = rl()
    r.question(`${question}: `, (answer) => {
      r.close()
      Bun.spawnSync(["stty", "echo"])
      console.log("")
      resolve(answer.trim())
    })
  })
}

function askYN(question: string, defaultVal: "y" | "n" = "y"): Promise<boolean> {
  const r = rl()
  return new Promise((resolve) => {
    r.question(`${question} (${defaultVal === "y" ? "Y/n" : "y/N"}): `, (answer) => {
      r.close()
      const a = answer.trim().toLowerCase()
      if (!a) resolve(defaultVal === "y")
      else resolve(a === "y")
    })
  })
}

export async function runSetup(): Promise<void> {
  const home = process.env.HOME ?? "/tmp"
  const cfgDir = `${home}/.agents-office`
  const cfgFile = `${cfgDir}/config.json`

  // Try to load existing config
  let existing: Record<string, string> = {}
  try { existing = JSON.parse(fs.readFileSync(cfgFile, "utf-8")) } catch {}

  console.log(`agents-office setup`)
  console.log(`  config: ${cfgFile}\n`)

  const port = await ask("Port", existing.port ?? "8080")
  const password = await askPassword("Password (leave empty to disable)")
  const webRoot = await ask("Web root path (Vite build output)", existing.web_root ?? "")
  const projectsRoot = await ask("Projects root (Claude Code projects)", existing.projects_root ?? "")
  const agBrainRoot = await ask("Antigravity brain root", existing.ag_brain_root ?? "")
  const maxDesks = await ask("Max desks per floor", existing.max_desks ?? "16")
  const opencodeSseUrl = await ask("OpenCode SSE URL (optional)", existing.opencode_sse_url ?? "")
  const verbose = await askYN("Verbose logging", existing.verbose === "true" ? "y" : "n")

  const cfg: Record<string, string> = { port, web_root: webRoot, projects_root: projectsRoot, ag_brain_root: agBrainRoot, max_desks: maxDesks, verbose: String(verbose) }
  if (password) cfg.password = password
  if (opencodeSseUrl) cfg.opencode_sse_url = opencodeSseUrl

  try { fs.mkdirSync(cfgDir, { recursive: true }) } catch {}
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2))

  console.log(`\n  \u2713 config written to ${cfgFile}`)

  const installHooks = await askYN("\nInstall Claude Code hooks now?")
  if (installHooks) {
    const claudeSettings = `${home}/.claude/settings.json`
    let settings: Record<string, unknown> = {}
    try { settings = JSON.parse(fs.readFileSync(claudeSettings, "utf-8")) } catch {}
    const events = ["SessionStart", "SessionEnd", "PreToolUse", "PostToolUse", "Notification"]
    settings.hooks = settings.hooks ?? {}
    const hooks = settings.hooks as Record<string, unknown>
    for (const ev of events) {
      hooks[ev] = [{ _agents_office: true, hooks: [{ command: "agents-office-hook", type: "command" }], matcher: ".*" }]
    }
    fs.mkdirSync(path.dirname(claudeSettings), { recursive: true })
    fs.writeFileSync(claudeSettings, JSON.stringify(settings, null, 2))
    console.log(`  \u2713 Claude Code hooks installed`)
  }
}
