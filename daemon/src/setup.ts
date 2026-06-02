import * as readline from "readline";
import { DEFAULTS, loadFileConfig, saveConfig, defaultConfigPath } from "./config";
import type { Config } from "./config";

const VERSION = "0.1.25";

function rl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(question: string, defaultVal = ""): Promise<string> {
  const r = rl();
  return new Promise((resolve) => {
    const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    r.question(prompt, (answer) => {
      r.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

function askPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    Bun.spawnSync(["stty", "-echo"]);
    const r = rl();
    r.question(`${question}: `, (answer) => {
      r.close();
      Bun.spawnSync(["stty", "echo"]);
      console.log("");
      resolve(answer.trim());
    });
  });
}

function askYN(question: string, defaultVal: "y" | "n" = "y"): Promise<boolean> {
  const r = rl();
  const hint = defaultVal === "y" ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    r.question(`${question} (${hint}): `, (answer) => {
      r.close();
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defaultVal === "y");
      else resolve(a === "y");
    });
  });
}

async function askSelect(question: string, options: string[]): Promise<string> {
  console.log(`\n  ${question}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`    ${i + 1}) ${options[i]}`);
  }
  const r = rl();
  return new Promise((resolve) => {
    r.question(`  Choice (1-${options.length}): `, (answer) => {
      r.close();
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < options.length) resolve(options[idx]!);
      else resolve(options[0]!);
    });
  });
}

export async function runSetup(): Promise<void> {
  console.log(`\n  agents-office setup v${VERSION}\n`);

  // 1. Check for existing config
  const existingConfig = loadFileConfig();
  const hasConfig = Object.keys(existingConfig).length > 0;

  if (hasConfig) {
    console.log("  Existing config found at ~/.agents-office/config.json:");
    const modeLabel = existingConfig.mode === "forwarder" ? "forwarder" : "daemon";
    console.log(`    Mode: ${modeLabel}`);
    if (existingConfig.mode === "forwarder") {
      console.log(`    Server: ${existingConfig.serverUrl || "(not set)"}`);
    } else {
      console.log(`    Port: ${existingConfig.port ?? 8080}`);
    }
    console.log(`    Password: ${existingConfig.password ? "(set)" : "(not set)"}`);
    console.log(`    Verbose: ${existingConfig.verbose ? "yes" : "no"}`);

    if (await askYN("  Use existing config?")) {
      if (await askYN("  Start now?")) {
        if (existingConfig.mode === "forwarder") {
          console.log("  Starting forwarder...");
          const { runForwarder } = await import("./forwarder");
          const fwdArgs: string[] = [];
          if (existingConfig.serverUrl) fwdArgs.push("--server", existingConfig.serverUrl);
          if (existingConfig.password) fwdArgs.push("--password", existingConfig.password);
          if (existingConfig.verbose) fwdArgs.push("--verbose");
          runForwarder(fwdArgs);
        } else {
          console.log("  Starting daemon...");
          Bun.spawnSync(["sudo", "systemctl", "restart", "agents-office"]);
          console.log("  ✓ Daemon started");
        }
      }
      return;
    }
    console.log("");
  }

  // 2. Mode selection
  const mode = await askSelect("Select mode:", ["Local daemon", "Remote forwarder"]);
  const isDaemon = mode === "Local daemon";
  const cfg: Partial<Config> = { mode: isDaemon ? "daemon" : "forwarder" };

  console.log("");

  // 3. Connection details
  if (isDaemon) {
    cfg.port = parseInt(await ask("Port", String(DEFAULTS.port)), 10) || DEFAULTS.port;
    const pw = await askPassword("Password (press Enter for no password)");
    if (pw) cfg.password = pw;
  } else {
    let url = await ask("Server URL", "playground-agents-office.lessch4os.com");
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) url = `wss://${url}`;
    if (!url.endsWith("/hook")) url = `${url.replace(/\/+$/, "")}/hook`;
    cfg.serverUrl = url;
    const pw = await askPassword("Server password");
    if (pw) cfg.password = pw;
  }

  console.log("");

  // 4. Verbose
  cfg.verbose = await askYN("Enable verbose logging?", "n");

  console.log("");

  // 5. Auto-start on server (create systemd service)
  let autoStartService = false;
  if (isDaemon) {
    autoStartService = await askYN("Create systemd service for auto-start?");
    if (autoStartService) {
      try {
        const serviceName = "agents-office";
        const binaryPath = process.execPath || "/usr/local/bin/agents-office";
        const pw = cfg.password || "";
        const webRoot = await resolveWebRoot();
        const cmd = `${binaryPath} --port ${cfg.port}${pw ? ` --password ${pw}` : ""}` +
          (webRoot ? ` --web-root ${webRoot}` : "") +
          (cfg.verbose ? " --verbose" : "");

        const serviceContent = `[Unit]
Description=agents-office daemon
After=network.target

[Service]
Type=simple
ExecStart=${cmd}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
        const servicePath = "/etc/systemd/system/agents-office.service";
        const r = Bun.spawnSync(["sudo", "tee", servicePath], {
          input: Buffer.from(serviceContent),
        });
        if (r.exitCode === 0) {
          Bun.spawnSync(["sudo", "systemctl", "daemon-reload"]);
          Bun.spawnSync(["sudo", "systemctl", "enable", serviceName]);
          Bun.spawnSync(["sudo", "systemctl", "restart", serviceName]);
          console.log("  ✓ Systemd service created and started");
        } else {
          console.warn("  Failed to create systemd service (non-fatal)");
        }
      } catch {
        console.warn("  Failed to create systemd service (non-fatal)");
      }
    }
  }

  console.log("");

  // 6. Save config
  const save = await askYN("Save configuration to ~/.agents-office/config.json?");
  if (save) {
    saveConfig(cfg);
    console.log("  ✓ Configuration saved to ~/.agents-office/config.json");
  }

  console.log("");

  // 7. Start now
  const start = await askYN("Start now?");
  if (start) {
    if (isDaemon) {
      if (autoStartService) {
        console.log("  Starting daemon via systemd...");
        Bun.spawnSync(["sudo", "systemctl", "restart", "agents-office"]);
        console.log("  ✓ Daemon started");
      } else {
        console.log("  To start manually: agents-office --port ${cfg.port}" +
          (cfg.password ? " --password <your-password>" : "") +
          (cfg.verbose ? " --verbose" : ""));
      }
    } else {
      console.log("  Starting forwarder...");
      const { runForwarder } = await import("./forwarder");
      const fwdArgs: string[] = [];
      if (cfg.serverUrl) fwdArgs.push("--server", cfg.serverUrl);
      if (cfg.password) fwdArgs.push("--password", cfg.password);
      if (cfg.verbose) fwdArgs.push("--verbose");
      runForwarder(fwdArgs);
    }
  }

  console.log("");
}

async function resolveWebRoot(): Promise<string> {
  // Try common paths
  const candidates = [
    "/usr/local/share/agents-office/web-dist",
    "/opt/homebrew/opt/agents-office/libexec/web-dist",
  ];
  for (const p of candidates) {
    try {
      const f = Bun.file(`${p}/index.html`);
      if (await f.exists()) return p;
    } catch {}
  }
  return "";
}
