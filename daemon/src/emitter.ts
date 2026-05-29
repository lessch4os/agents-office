import { SceneState } from "./state";
import { Reducer } from "./reducer";
import { sceneToWire } from "./wire";
import type { Transport, AgentEvent } from "./types";
import { eventToWireLogEntry } from "./types";
import type { Logger } from "./logger";
import { SessionStore } from "./session-store";

export class EmitManager {
  private lastBroadcast = "";
  private toolStartTimes = new Map<number, number>();

  constructor(
    private scene: SceneState,
    private reducer: Reducer,
    private store: SessionStore | null,
    private clients: Set<WebSocket> | null,
    private fileLog: ((line: string) => void) | null,
    private log: Logger,
  ) {}

  emit(transport: Transport, event: AgentEvent): void {
    const now = Date.now();
    const idNum = event.agentId.toNumber();
    const sid = event.type === "sessionStart" ? ` session=${event.sessionId}` : "";
    this.log.verbose(`[emit] ${transport} ${event.type} id=${idNum}${sid}`);
    this.reducer.apply(this.scene, event, now, transport);

    if (this.store) {
      this.store.onEvent(event, this.scene.agents.get(event.agentId.value), now, this.scene.agents);
    }

    this.broadcast();

    if (this.fileLog) {
      const slot = this.scene.agents.get(event.agentId.value);
      const sessionId = slot?.sessionId ?? (event.type === "sessionStart" ? event.sessionId : "?");
      let extra = "";
      if (event.type === "tokenUsage" && slot) {
        const pct = slot.contextWindowLimit > 0
          ? Math.round((slot.contextInputTokens / slot.contextWindowLimit) * 100)
          : 0;
        extra = ` input=${event.input} output=${event.output} cache=${event.cacheRead ?? 0} cumul_in=${slot.tokenInputTotal} cumul_out=${slot.tokenOutputTotal} limit=${slot.contextWindowLimit} pct=${pct}%`;
      } else if (event.type === "sessionStart") {
        extra = ` cwd=${event.cwd} limit=${event.contextWindowLimit ?? 0}`;
      } else if (event.type === "modelUpdate") {
        extra = ` model=${event.modelId} limit=${event.contextWindowLimit ?? "?"}`;
      } else if (event.type === "activityStart" && event.detail) {
        const toolName = event.detail.type === "generic" ? event.detail.toolName : "Task";
        extra = ` tool=${toolName}`;
      }
      this.fileLog(`daemon transport=${transport} type=${event.type} agent=${event.agentId.toString()} sid=${sessionId}${extra}`);
    }

    if (event.type === "activityStart") {
      this.toolStartTimes.set(idNum, now);
    }

    let durationMs: number | undefined;
    if (event.type === "activityEnd") {
      const started = this.toolStartTimes.get(idNum);
      if (started) {
        durationMs = now - started;
        this.toolStartTimes.delete(idNum);
      }
    }

    const logEntry = eventToWireLogEntry(event, idNum, now, durationMs);
    if (logEntry && this.clients) {
      const logJson = JSON.stringify({ type: "log", data: logEntry });
      for (const ws of this.clients) {
        try { ws.send(logJson); } catch { this.clients.delete(ws); }
      }
    }
  }

  tick(now: number): void {
    this.reducer.tick(this.scene, now);
    this.broadcast();
  }

  broadcast(): void {
    if (!this.clients || this.clients.size === 0) return;
    const wire = sceneToWire(this.scene, Date.now());
    const json = JSON.stringify({ type: "scene", data: wire });
    if (json === this.lastBroadcast) return;
    this.lastBroadcast = json;
    for (const ws of this.clients) {
      try { ws.send(json); } catch { this.clients.delete(ws); }
    }
  }
}
