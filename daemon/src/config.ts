import * as fs from "fs";
import * as path from "path";

export interface Config {
  port: number;
  password: string;
  username: string;
  socketPath: string;
  maxDesks: number;
  webRoot: string;
  projectsRoot: string;
  agBrainRoot: string;
  opencodeSseUrl: string | null;
  relayTo: string | null;
  db: string;
  verbose: boolean;
  mode: "daemon" | "forwarder" | "setup";
  // Forwarder-specific
  serverUrl: string;
}

const home = process.env.HOME ?? "/tmp";
const uid = process.getuid?.() ?? 0;

export function defaultConfigPath(): string {
  return `${home}/.agents-office/config.json`;
}

export function defaultSocketPath(): string {
  if (process.env.AGENTS_OFFICE_SOCKET) return process.env.AGENTS_OFFICE_SOCKET;
  if (process.env.XDG_RUNTIME_DIR) return `${process.env.XDG_RUNTIME_DIR}/agents-office.sock`;
  return `/tmp/agents-office-${uid}.sock`;
}

export const DEFAULTS: Config = {
  port: 8080,
  password: "",
  username: "agents-office",
  socketPath: defaultSocketPath(),
  maxDesks: 16,
  webRoot: "",
  projectsRoot: `${home}/.claude/projects`,
  agBrainRoot: `${home}/.gemini/antigravity-cli/brain`,
  opencodeSseUrl: null,
  relayTo: null,
  db: `${home}/.agents-office/sessions.db`,
  verbose: false,
  mode: "daemon",
  serverUrl: "",
};

export function loadFileConfig(): Partial<Config> {
  const configPath = defaultConfigPath();
  try {
    const text = fs.readFileSync(configPath, "utf-8");
    const raw = JSON.parse(text);
    const result: Partial<Config> = {};
    if (raw.port != null) result.port = raw.port;
    if (raw.password) result.password = raw.password;
    if (raw.username) result.username = raw.username;
    if (raw.socket) result.socketPath = raw.socket;
    if (raw.max_desks != null) result.maxDesks = raw.max_desks;
    if (raw.web_root) result.webRoot = raw.web_root;
    if (raw.projects_root) result.projectsRoot = raw.projects_root;
    if (raw.ag_brain_root) result.agBrainRoot = raw.ag_brain_root;
    if (raw.opencode_sse_url) result.opencodeSseUrl = raw.opencode_sse_url;
    if (raw.relay_to) result.relayTo = raw.relay_to;
    if (raw.db) result.db = raw.db;
    if (raw.verbose != null) result.verbose = raw.verbose;
    if (raw.mode) result.mode = raw.mode;
    if (raw.server || raw.server_url) result.serverUrl = raw.server ?? raw.server_url;
    return result;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: Partial<Config>): void {
  const configPath = defaultConfigPath();
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  const raw: Record<string, unknown> = {};
  if (cfg.port != null) raw.port = cfg.port;
  if (cfg.password) raw.password = cfg.password;
  if (cfg.username) raw.username = cfg.username;
  if (cfg.socketPath) raw.socket = cfg.socketPath;
  if (cfg.maxDesks != null) raw.max_desks = cfg.maxDesks;
  if (cfg.webRoot) raw.web_root = cfg.webRoot;
  if (cfg.projectsRoot) raw.projects_root = cfg.projectsRoot;
  if (cfg.agBrainRoot) raw.ag_brain_root = cfg.agBrainRoot;
  if (cfg.opencodeSseUrl) raw.opencode_sse_url = cfg.opencodeSseUrl;
  if (cfg.relayTo) raw.relay_to = cfg.relayTo;
  if (cfg.db) raw.db = cfg.db;
  if (cfg.verbose) raw.verbose = true;
  raw.mode = cfg.mode ?? "daemon";
  if (cfg.serverUrl) raw.server_url = cfg.serverUrl;
  fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n");
}
