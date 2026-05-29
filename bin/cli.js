#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");

const cmd = process.argv[2];
const args = process.argv.slice(3);
const pkgDir = path.join(__dirname, "..");

function bunRun(scriptRel, extraArgs) {
  const fullPath = path.join(pkgDir, scriptRel);
  const proc = spawn("bun", [fullPath, ...extraArgs], {
    stdio: "inherit",
    env: { ...process.env, AO_PKG_DIR: pkgDir },
  });
  proc.on("exit", (code) => process.exit(code ?? 1));
}

switch (cmd) {
  case "install":
  case "install:all":
    bunRun("bin/install-hooks.js", args);
    bunRun("bin/install-opencode.js", args);
    break;
  case "install-hooks":
  case "install:cc":
    bunRun("bin/install-hooks.js", args);
    break;
  case "install-opencode":
  case "install:oc":
    bunRun("bin/install-opencode.js", args);
    break;
  case "forwarder":
  case "forward":
    bunRun("bin/agents-office-forwarder.js", args);
    break;
  case "hook":
    bunRun("bin/agents-office-hook.js", args);
    break;
  case "--help":
  case "help":
    console.log("agents-office <command>");
    console.log("");
    console.log("Commands:");
    console.log("  (no args)       Start daemon");
    console.log("  install         Install CC hooks + OC plugin");
    console.log("  install-hooks   Install Claude Code hooks only");
    console.log("  install-opencode Install OpenCode plugin only");
    console.log("  forwarder       Start forwarder (relay hooks to server)");
    console.log("  hook            Run hook shim (internal)");
    console.log("");
    console.log("Options for daemon:");
    console.log("  --port <n>       Port (default: 8080)");
    console.log("  --password <s>   Auth password for server mode");
    console.log("  --relay-to <url> Forward events to remote server");
    console.log("");
    console.log("Options for forwarder:");
    console.log("  --server <url>   Server WebSocket URL");
    console.log("  --password <s>   Server password");
    break;
  default:
    // Run daemon with all original args
    bunRun("daemon/src/main.ts", process.argv.slice(2));
    break;
}
