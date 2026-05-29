import { basename } from "path";
import { AgentId } from "./agent-id";
import { AgentEvent, Activity } from "./types";
import { describeToolTarget, makeToolDetail, getStr } from "./decoder";

// ── Line decoder ───────────────────────────────────────────────────

export function decodeAgLine(
  transcriptPath: string,
  source: string,
  json: Record<string, unknown>,
): AgentEvent[] {
  const agentId = AgentId.fromParts(source, transcriptPath);

  if (!("step_index" in json)) return [];

  const stepIndex = typeof json["step_index"] === "number" ? (json["step_index"] as number) : 0;
  const stepType = json["type"];

  const out: AgentEvent[] = [];

  if (stepType === "PLANNER_RESPONSE") {
    const toolCalls = json["tool_calls"];
    if (Array.isArray(toolCalls)) {
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        if (!tc || typeof tc !== "object" || Array.isArray(tc)) continue;
        const tcObj = tc as Record<string, unknown>;

        const name = typeof tcObj["name"] === "string" ? (tcObj["name"] as string) : "?";
        const args = tcObj["args"];

        if (name === "ask_permission" || name === "ask_question") {
          out.push({ type: "waiting", agentId, reason: "asking permission" });
        } else {
          const normalizedInput: Record<string, string> = {};
          if (args && typeof args === "object" && !Array.isArray(args)) {
            const argsObj = args as Record<string, unknown>;
            const rawVal =
              getStr(argsObj, "DirectoryPath") ??
              getStr(argsObj, "AbsolutePath") ??
              getStr(argsObj, "TargetFile") ??
              getStr(argsObj, "CommandLine") ??
              getStr(argsObj, "SearchPath") ??
              getStr(argsObj, "query");

            if (rawVal !== undefined) {
              const clean = rawVal.startsWith('"') && rawVal.endsWith('"')
                ? rawVal.slice(1, -1)
                : rawVal;
              const key = name === "run_command"
                ? "command"
                : name === "grep_search"
                  ? "pattern"
                  : "file_path";
              normalizedInput[key] = clean;
            }
          }

          const target = describeToolTarget(name, normalizedInput);
          out.push({
            type: "activityStart",
            agentId,
            activity: "typing" as Activity,
            toolUseId: `ag-${stepIndex}-${i}`,
            detail: makeToolDetail(name, target),
          });
        }
      }
    }
  } else if (stepType !== "USER_INPUT" && stepType !== "CONVERSATION_HISTORY" && stepIndex > 0) {
    out.push({
      type: "activityEnd",
      agentId,
      toolUseId: `ag-${stepIndex - 1}-0`,
    });
  }

  return out;
}

// ── Session-ended checker ──────────────────────────────────────────

export function agSessionEnded(_tail: Uint8Array): boolean {
  return false;
}

// ── Label deriver ──────────────────────────────────────────────────

export function deriveAgLabel(cwd: string): string {
  const base = basename(cwd);
  if (base && base !== "/") return `ag\u00b7${base}`;
  return "ag";
}
