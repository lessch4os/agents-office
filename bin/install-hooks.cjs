#!/usr/bin/env node
// Install Claude Code hooks — builds hook-shim + patches settings.json
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const pkgDir = process.env.AO_PKG_DIR || path.join(__dirname, "..");
const hookShimSrc = path.join(pkgDir, "daemon/src/hook-shim.ts");
const hookBin = path.join(os.tmpdir(), "agents-office-hook");
const settingsPath = process.env.CLAUDE_SETTINGS || path.join(os.homedir(), ".claude/settings.json");

// ── Build hook binary ────────────────────────────────────────────
console.log("==> Building hook binary...");
execSync(`bun build --compile --target=bun "${hookShimSrc}" --outfile="${hookBin}" 2>&1`, { stdio: "inherit" });
console.log("  Hook binary:", hookBin);

// ── Read existing settings ──────────────────────────────────────
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(settingsPath, "utf-8")); } catch {}

// ── Patch hooks ──────────────────────────────────────────────────
const SENTINELS = ["_agents_office", "_ascii_agents"];
const HOOK_EVENTS = ["SessionStart", "SessionEnd", "PreToolUse", "PostToolUse", "Notification"];

const hookEntry = {
  _agents_office: true,
  hooks: [{ command: hookBin, type: "command" }],
  matcher: ".*",
};

cfg.hooks = cfg.hooks || {};
for (const event of HOOK_EVENTS) {
  const entries = cfg.hooks[event];
  if (!Array.isArray(entries)) { cfg.hooks[event] = [hookEntry]; continue; }

  // Remove old sentinel entries, keep others
  const kept = entries.filter((e) => !SENTINELS.some((s) => e[s] === true));
  // Update migrated entry with new path
  const migrated = entries.filter((e) => SENTINELS.some((s) => e[s] === true));
  for (const m of migrated) {
    for (const s of SENTINELS) delete m[s];
    if (Array.isArray(m.hooks)) for (const h of m.hooks) h.command = hookBin;
    m._agents_office = true;
    kept.push(m);
  }
  if (migrated.length === 0) kept.push(hookEntry);
  cfg.hooks[event] = kept;
}

// ── Write back ───────────────────────────────────────────────────
const tmp = settingsPath + ".tmp." + process.pid;
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
fs.renameSync(tmp, settingsPath);
console.log("  Wrote hooks to", settingsPath);
console.log("==> Done. Restart Claude Code.");
