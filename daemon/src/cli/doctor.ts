import fs from "fs"
import path from "path"
import os from "os"

const home = process.env.HOME ?? "/tmp"
const uid = process.getuid?.() ?? 0

function ok(msg: string) { console.log(`  \u2713 ${msg}`) }
function warn(msg: string) { console.log(`  \u26A0 ${msg}`) }
function fail(msg: string) { console.log(`  \u2717 ${msg}`) }
function note(msg: string) { console.log(`  ${msg}`) }

function which(name: string): string | null {
  const r = Bun.spawnSync(["which", name])
  return r.exitCode === 0 ? r.stdout.toString().trim() : null
}

function pgrep(name: string, exact = true): number | null {
  try {
    const args = exact ? ["pgrep", "-x", name] : ["pgrep", "-f", name]
    const r = Bun.spawnSync(args)
    if (r.exitCode === 0) return parseInt(r.stdout.toString().trim().split("\n")[0]!, 10)
  } catch {}
  return null
}

export function runDoctor(): void {
  let exitCode = 0
  const c = (label: string) => { console.log(`\n${label}:`); return { ok: () => {}, warn: () => {}, fail: () => {} } }

  // Binary
  console.log("\nBinary:")
  const binaryPath = which("agents-office")
  if (binaryPath) {
    const r = Bun.spawnSync([binaryPath, "--version"])
    const ver = r.exitCode === 0 ? r.stdout.toString().trim() : "?"
    ok(`agents-office found: ${binaryPath} (v${ver})`)
  } else {
    fail("agents-office not found in PATH")
    exitCode = 1
  }

  // Bun
  console.log("\nRuntime:")
  const bunPath = which("bun")
  if (bunPath) {
    const r = Bun.spawnSync(["bun", "--version"])
    const ver = r.exitCode === 0 ? r.stdout.toString().trim() : "?"
    ok(`bun found: ${bunPath} (v${ver})`)
  } else {
    warn("bun not found in PATH (not needed if using standalone binary)")
  }

  // Processes
  console.log("\nProcesses:")
  const daemonPid = pgrep("agents-office")
  if (daemonPid) ok(`agents-office running (pid ${daemonPid})`)
  else warn("agents-office not running")

  const ccPids = pgrep("claude", false)
  if (ccPids !== null) ok(`Claude Code running (pid ${ccPids})`)
  else note("\u2014 Claude Code not running")

  // Config
  console.log("\nConfig:")
  const cfgDir = `${home}/.agents-office`
  const cfgFile = `${cfgDir}/config.json`
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf-8"))
    ok(`config found: ${cfgFile}`)
    const hasWeb = cfg.web_root || cfg.projects_root
    if (!hasWeb) warn("config missing web_root or projects_root")
  } catch {
    warn(`config not found: ${cfgFile}`)
  }

  // Socket
  console.log("\nSocket:")
  const sockPaths = [
    `/run/user/${uid}/agents-office.sock`,
    `/tmp/agents-office-${uid}.sock`,
    process.env.XDG_RUNTIME_DIR ? `${process.env.XDG_RUNTIME_DIR}/agents-office.sock` : null,
  ].filter(Boolean) as string[]

  let foundSocket = false
  for (const sp of sockPaths) {
    try {
      const stat = fs.statSync(sp)
      if (stat.isSocket()) { ok(`socket found: ${sp}`); foundSocket = true }
    } catch {}
  }
  if (!foundSocket) warn("no agents-office socket found (daemon may not be running)")

  // Database
  console.log("\nDatabase:")
  const dbPath = `${cfgDir}/sessions.db`
  try {
    const stat = fs.statSync(dbPath)
    const mb = (stat.size / (1024 * 1024)).toFixed(1)
    ok(`database found: ${dbPath} (${mb} MB)`)
  } catch {
    warn(`database not found: ${dbPath}`)
  }

  // Claude Code hooks
  console.log("\nHooks:")
  const claudeSettings = `${home}/.claude/settings.json`
  try {
    const settings = JSON.parse(fs.readFileSync(claudeSettings, "utf-8"))
    const hooks = settings.hooks
    if (hooks) ok(`Claude Code hooks configured (${Object.keys(hooks).length} events)`)
    else warn("no hooks found in Claude Code settings")
  } catch {
    warn(`Claude Code settings not found: ${claudeSettings}`)
  }

  // OpenCode plugin
  const ocPlugin = `${home}/.config/opencode/plugins/agents-office.js`
  try {
    fs.accessSync(ocPlugin)
    ok(`OpenCode plugin installed: ${ocPlugin}`)
  } catch {
    warn(`OpenCode plugin not installed: ${ocPlugin}`)
  }

  // Clipboard
  console.log("\nClipboard:")
  const clipTools = ["wl-copy", "xclip", "pbcopy"].filter((t) => which(t))
  if (clipTools.length > 0) ok(`clipboard tool found: ${clipTools[0]}`)
  else warn("no clipboard tool found (wl-copy/xclip/pbcopy)")

  // Logs
  console.log("\nLogs:")
  const logDir = `${cfgDir}/logs`
  try {
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith(".log")).sort().reverse().slice(0, 3)
    if (files.length > 0) {
      ok(`log files found (showing last ${files.length})`)
      for (const f of files) {
        const stat = fs.statSync(path.join(logDir, f))
        const kb = (stat.size / 1024).toFixed(0)
        note(`  ${f} (${kb} KB)`)
      }
    } else warn("no log files found")
  } catch {
    warn(`log directory not found: ${logDir}`)
  }

  console.log("")
  if (exitCode === 0) ok("all checks passed")
  else warn(`${exitCode} issue(s) found`)
  process.exitCode = exitCode
}
