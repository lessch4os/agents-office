#!/usr/bin/env node
// Install OpenCode plugin — builds opencode-plugin.ts + copies to plugins dir
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const pkgDir = process.env.AO_PKG_DIR || path.join(__dirname, "..");
const pluginSrc = path.join(pkgDir, "daemon/src/opencode-plugin.ts");
const pluginDir = process.env.OPENCODE_PLUGIN_DIR || path.join(os.homedir(), ".config/opencode/plugins");

// ── Build plugin ─────────────────────────────────────────────────
console.log("==> Building OpenCode plugin...");
const outDir = path.join(os.tmpdir(), "agents-office-plugin-" + process.pid);
fs.mkdirSync(outDir, { recursive: true });

// Build with bun (no tsc needed — bun handles TS natively)
execSync(`bun build "${pluginSrc}" --outdir "${outDir}" --target bun --format esm --external @opencode-ai/sdk 2>&1`, { stdio: "inherit" });

fs.mkdirSync(pluginDir, { recursive: true });

const outFile = path.join(outDir, "opencode-plugin.js");
const target = path.join(pluginDir, "agents-office.js");

// Copy instead of symlink (more portable)
if (fs.existsSync(target)) {
  const bak = target + ".bak";
  try { fs.renameSync(target, bak); console.log("  Backed up old plugin to", bak); } catch {}
}
fs.copyFileSync(outFile, target);
console.log("  Installed to", target);

// Cleanup
try { fs.rmSync(outDir, { recursive: true }); } catch {}

console.log("==> Done. Restart OpenCode.");
