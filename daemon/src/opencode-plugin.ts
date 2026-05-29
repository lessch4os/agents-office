import { basename } from "path";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";

const _logDir = process.env.AGENTS_OFFICE_LOG_DIR ?? `${process.env.HOME ?? "/tmp"}/.agents-office/logs`;
const LOG_PATH = process.env.AGENTS_OFFICE_PLUGIN_LOG ?? `${_logDir}/plugin.log`;
const LOG_MAX_BYTES = 10 * 1024 * 1024;

try { fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true }); } catch {}

function logFile(...args: unknown[]): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}\n`;
  try {
    const fd = fs.openSync(LOG_PATH, "a");
    const stat = fs.statSync(LOG_PATH);
    if (stat.size > LOG_MAX_BYTES) {
      fs.ftruncateSync(fd, 0);
    }
    fs.writeSync(fd, line);
    fs.closeSync(fd);
  } catch {}
}

// Step-finish tokens are per-step values (δ or cumulative).
// We track two prev pointers: one for step-finish (shared path),
// and one for message.updated which may send stale/zero tokens.
interface SessionState {
  prevInputTokens: number;
  prevOutputTokens: number;
  prevCacheReadTokens: number;
  cumulInputTokens: number;
  cumulOutputTokens: number;
  modelId: string | null;
  providerId: string | null;
  modelSent: boolean;
}

const MODEL_LIMITS: Record<string, number> = {
  "claude-sonnet-4-20250514": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
  "claude-opus-4-20250514": 200_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "o4-mini": 200_000,
  "o3": 200_000,
  "gemini-2.5-pro": 1_000_000,
  "gemini-2.0-flash": 1_000_000,
  "deepseek-chat": 64_000,
  "deepseek-v4-flash": 1_000_000,
};

export const AgentOfficePlugin = async ({
  project,
  directory,
}: {
  project?: { directory?: string };
  directory?: string;
}) => {
  const socketPath = resolveSocketPath();
  let toolSeq = 0;
  const sessions = new Map<string, SessionState>();

  let sock: net.Socket | null = null;
  let sendBuf = "";
  let sendPending = false;
  let lastTaskParentSessionId: string | null = null;

  function flushSend(): void {
    if (!sock || !sendBuf || sendPending) return;
    sendPending = true;
    const chunk = sendBuf;
    sendBuf = "";
    sock.write(chunk, () => {
      sendPending = false;
      if (sendBuf) flushSend();
    });
  }

  function connectSend(): void {
    if (sock && !sock.destroyed) return;
    sendPending = false;
    try {
      sock = net.createConnection(socketPath);
      sock.setTimeout(2000);
      sock.on("connect", () => { if (sendBuf) flushSend(); });
      sock.on("error", () => { sock = null; });
      sock.on("close", () => { sock = null; });
      sock.on("timeout", () => { sock?.destroy(); sock = null; });
    } catch { sock = null; }
  }

  function send(payload: Record<string, unknown>): void {
    sendBuf += JSON.stringify({ ...payload, _shim_ts_ms: Date.now(), source: "opencode" }) + "\n";
    if (!sock || sock.destroyed) connectSend();
    // Always try to flush. If the socket is still connecting, Node.js
    // buffers the write internally and delivers it when connected.
    // If the socket is destroyed/errored, flushSend returns safely.
    flushSend();
  }

  function getSession(sid: string): SessionState {
    let s = sessions.get(sid);
    if (!s) {
      s = { prevInputTokens: 0, prevOutputTokens: 0, prevCacheReadTokens: 0, cumulInputTokens: 0, cumulOutputTokens: 0, modelId: null, providerId: null, modelSent: false };
      sessions.set(sid, s);
    }
    return s;
  }

  function sendTokenUpdate(sid: string, input: number, output: number, cacheRead: number, total?: number): void {
    const usage: Record<string, number> = { input_tokens: input, output_tokens: output };
    if (cacheRead > 0) usage.cache_read_input_tokens = cacheRead;
    if (total != null && total > 0) usage.total_tokens = total;
    send({ hook_event_name: "TokenUpdate", session_id: sid, transcript_path: sid, usage });
  }

  // Track cumul from step-finish values.
  // step-finish tokens can be either:
  //   (a) per-step cumulative (monotonic) → delta = rawInput - cumul
  //   (b) per-step delta (smaller than cumul) → delta = rawInput
  function handleStepTokens(sid: string, tokens: Record<string, unknown>): void {
    const rawInput = (tokens.input as number) ?? 0;
    const rawOutput = (tokens.output as number) ?? 0;
    const rawCacheRead = (tokens.cache_read_input_tokens as number) ?? 0;
    const rawTotal = (tokens.total as number) ?? 0;
    if (rawInput <= 0 && rawOutput <= 0 && rawTotal <= 0) return;

    const s = getSession(sid);
    const inputDelta = rawInput > s.cumulInputTokens
      ? rawInput - s.cumulInputTokens   // cumulative mode
      : rawInput;                        // delta mode (rawInput < cumul)
    const outputDelta = rawOutput > s.cumulOutputTokens
      ? rawOutput - s.cumulOutputTokens
      : rawOutput;

    s.cumulInputTokens += Math.max(0, inputDelta);
    s.cumulOutputTokens += Math.max(0, outputDelta);

    const limit = MODEL_LIMITS[s.modelId ?? ""] ?? 200_000;
    const pct = limit > 0 ? Math.round((s.cumulInputTokens / limit) * 100) : 0;
    logFile(`tokens sid=${sid} source=step-finish delta_in=${inputDelta} delta_out=${outputDelta} cache_read=${rawCacheRead} cumul_in=${s.cumulInputTokens} cumul_out=${s.cumulOutputTokens} total=${rawTotal} model=${s.modelId ?? "?"} limit=${limit} pct=${pct}%`);

    sendTokenUpdate(sid, s.cumulInputTokens, s.cumulOutputTokens, rawCacheRead, rawTotal);
  }

  // message.updated tokens are unreliable (often zero or equal to current cumul).
  // Only update prev to detect subsequent legitimate token delta.
  function handleMessageTokens(sid: string, tokens: Record<string, unknown>): void {
    const rawInput = (tokens.input as number) ?? 0;
    const rawOutput = (tokens.output as number) ?? 0;
    const rawCacheRead = (tokens.cache_read_input_tokens as number) ?? 0;

    const s = getSession(sid);

    if (rawInput > s.prevInputTokens) s.prevInputTokens = rawInput;
    if (rawOutput > s.prevOutputTokens) s.prevOutputTokens = rawOutput;
    if (rawCacheRead > 0) s.prevCacheReadTokens = rawCacheRead;

    const limit = MODEL_LIMITS[s.modelId ?? ""] ?? 200_000;
    const pct = limit > 0 ? Math.round((s.cumulInputTokens / limit) * 100) : 0;
    logFile(`tokens sid=${sid} source=message.updated raw_in=${rawInput} raw_out=${rawOutput} cache_read=${rawCacheRead} cumul_in=${s.cumulInputTokens} cumul_out=${s.cumulOutputTokens} model=${s.modelId ?? "?"} limit=${limit} pct=${pct}%`);
  }

  return {
    event: async ({
      event,
    }: {
      event: { type: string; properties: Record<string, unknown> };
    }) => {
      switch (event.type) {
        case "session.created": {
          const props = event.properties;
          const info = props.info as Record<string, unknown> | undefined;
          const sid = info ? (info.id as string) ?? (props.sessionID as string) : (props.sessionID as string);
          if (!sid) return;
          const s = getSession(sid);
          const cwd = info
            ? (info.directory as string) ?? directory ?? project?.directory ?? ""
            : directory ?? project?.directory ?? "";
          const cl = s.modelId ? (MODEL_LIMITS[s.modelId] ?? 200_000) : 200_000;
          logFile(`session.created sid=${sid} cwd=${cwd} model=${s.modelId ?? "?"} limit=${cl}${lastTaskParentSessionId ? ` parent=${lastTaskParentSessionId}` : ""}`);

          // TokenDebug: dump full session.created properties for parent/child analysis
          send({
            hook_event_name: "TokenDebug",
            session_id: sid,
            transcript_path: sid,
            role: "session-created",
            source_event: "session.created",
            has_info: info != null,
            props_sessionID: props.sessionID,
            info_id: info?.id,
            info_sessionID: info?.sessionID,
            info_directory: info?.directory,
            info_modelID: info?.modelID,
            info_providerID: info?.providerID,
            info_parentID: info?.parentID,
            info_parentSessionID: info?.parentSessionID,
            lastTaskParentSessionId: lastTaskParentSessionId,
          });

          const sessionStartPayload: Record<string, unknown> = {
            hook_event_name: "SessionStart",
            session_id: sid,
            transcript_path: sid,
            cwd,
            agent_type: "opencode",
            context_window_limit: cl,
          };
          const parentId = (info?.parentID as string) ?? lastTaskParentSessionId;
          if (parentId && parentId !== sid) {
            sessionStartPayload.parent_session_id = parentId;
            logFile(`session.parent_link sid=${sid} parent=${parentId}`);
          }
          send(sessionStartPayload);
          send({
            hook_event_name: "Rename",
            session_id: sid,
            transcript_path: sid,
            label: `oc\u00b7${basename(cwd)}`,
          });
          break;
        }

        case "session.idle": {
          // Ignored — daemon's expirePendingIdles (1500ms debounce after activityEnd)
          // handles Active→Idle transitions correctly. session.idle fires during LLM
          // thinking, not when genuinely idle.
          break;
        }

        case "session.error": {
          const sid = event.properties.sessionID as string | undefined;
          const rawError = event.properties.error;
          const err =
            typeof rawError === "string"
              ? rawError
              : rawError && typeof rawError === "object"
                ? ((rawError as Record<string, unknown>).message as string) ??
                  "unknown"
                : "unknown";
          const id = sid ?? crypto.randomUUID();
          logFile(`session.error sid=${id} err=${err.slice(0, 200)}`);
          send({
            hook_event_name: "StopFailure",
            session_id: id,
            transcript_path: id,
            error: err,
          });
          break;
        }

        case "session.deleted": {
          const props = event.properties;
          const info = props.info as Record<string, unknown> | undefined;
          if (!info) return;
          const sid =
            (info.id as string) ?? (props.sessionID as string);
          logFile(`session.deleted sid=${sid}`);
          send({
            hook_event_name: "SessionEnd",
            session_id: sid,
            transcript_path: sid,
          });
          sessions.delete(sid);
          break;
        }

        case "session.status": {
          const sinfo = event.properties.info as
            | Record<string, unknown>
            | undefined;
          if (!sinfo) break;
          const sids = (sinfo.sessionID as string) ?? (event.properties.sessionID as string);
          if (!sids) break;
          send({
            hook_event_name: "TokenDebug",
            session_id: sids,
            transcript_path: sids,
            role: "session-status",
            status: event.properties.status as string,
            source_event: "session.status",
          });
          break;
        }

        case "session.updated": {
          const uinfo = event.properties.info as
            | Record<string, unknown>
            | undefined;
          if (!uinfo) break;
          const usid = (uinfo.sessionID as string) ?? (event.properties.sessionID as string);
          if (!usid) break;
          const utokens = uinfo.tokens as Record<string, unknown> | undefined;
          send({
            hook_event_name: "TokenDebug",
            session_id: usid,
            transcript_path: usid,
            role: "session-updated",
            source_event: "session.updated",
            has_tokens: utokens != null,
            token_data: utokens ?? null,
            session_info: {
              modelID: uinfo.modelID,
              providerID: uinfo.providerID,
              status: event.properties.status,
            },
          });
          break;
        }

        case "message.updated": {
          const info = event.properties.info as
            | Record<string, unknown>
            | undefined;
          if (!info) break;
          const sid = info.sessionID as string;
          if (!sid) break;
          const tokens = info.tokens as Record<string, unknown> | undefined;

          // TokenDebug: log ALL roles and token data (including user/system)
          send({
            hook_event_name: "TokenDebug",
            session_id: sid,
            transcript_path: sid,
            role: info.role as string,
            has_tokens: tokens != null,
            token_data: tokens ?? null,
            source_event: "message.updated",
          });

          if ((info.role as string) !== "assistant") break;
          if (!tokens) break;
          const s = getSession(sid);
          handleMessageTokens(sid, tokens);
          if (info.modelID && info.modelID !== s.modelId) {
            s.modelId = info.modelID as string;
            s.modelSent = false;
          }
          if (info.providerID) s.providerId = info.providerID as string;
          if (s.modelId && !s.modelSent) {
            s.modelSent = true;
            const cl = MODEL_LIMITS[s.modelId] ?? 200_000;
            logFile(`model.update sid=${sid} model=${s.modelId} limit=${cl}`);
            send({
              hook_event_name: "ModelUpdate",
              session_id: sid,
              transcript_path: sid,
              model_id: s.modelId,
              context_window_limit: cl,
            });
          }
          break;
        }

        case "message.part.updated": {
          const part = event.properties.part as
            | Record<string, unknown>
            | undefined;
          if (!part || (part.type as string) !== "step-finish") return;
          const sid = part.sessionID as string;
          if (!sid) return;
          const tokens = part.tokens as Record<string, unknown> | undefined;
          if (!tokens) return;

          // TokenDebug: log step-finish token data
          send({
            hook_event_name: "TokenDebug",
            session_id: sid,
            transcript_path: sid,
            role: "step-finish",
            has_tokens: true,
            token_data: tokens as Record<string, unknown>,
            source_event: "message.part.updated",
          });

          handleStepTokens(sid, tokens);
          break;
        }
      }
    },

    "tool.execute.before": async (input: Record<string, unknown>) => {
      toolSeq++;
      const sid = typeof input.sessionID === "string" ? input.sessionID : "";
      const toolName = typeof input.tool === "string" ? input.tool : "?";
      const toolInput = (input as Record<string, unknown>).args ?? {};
      const toolUseId = `oc-${toolSeq}`;
      const argsPreview = JSON.stringify(toolInput).slice(0, 200);
      logFile(`tool.start sid=${sid} tool=${toolName} seq=${toolSeq} args=${argsPreview}`);
      if (toolName === "Task" || toolName === "Agent") {
        lastTaskParentSessionId = sid;
      }
      send({
        hook_event_name: "PreToolUse",
        session_id: sid,
        transcript_path: sid,
        tool_name: toolName,
        tool_input: toolInput,
        tool_use_id: toolUseId,
      });
    },

    "tool.execute.after": async (input: Record<string, unknown>) => {
      const sid = typeof input.sessionID === "string" ? input.sessionID : "";
      const toolName = typeof input.tool === "string" ? input.tool : "?";
      logFile(`tool.end sid=${sid} tool=${toolName} seq=${toolSeq}`);
      if ((toolName === "Task" || toolName === "Agent") && lastTaskParentSessionId === sid) {
        lastTaskParentSessionId = null;
      }
      send({
        hook_event_name: "PostToolUse",
        session_id: sid,
        transcript_path: sid,
        tool_use_id: `oc-${toolSeq}`,
      });
    },
  };
};

function resolveSocketPath(): string {
  if (process.env.AGENTS_OFFICE_SOCKET) return process.env.AGENTS_OFFICE_SOCKET;
  if (process.env.XDG_RUNTIME_DIR) return `${process.env.XDG_RUNTIME_DIR}/agents-office.sock`;
  const uid = process.getuid?.() ?? 0;
  return `/tmp/agents-office-${uid}.sock`;
}


