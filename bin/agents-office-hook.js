#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");
const script = path.join(__dirname, "../daemon/src/hook-shim.ts");
const proc = spawn("bun", [script, ...process.argv.slice(2)], { stdio: "inherit" });
proc.on("exit", (code) => process.exit(code ?? 1));
