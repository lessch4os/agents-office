// ── Random ID helpers ──────────────────────────────────────────────

export function uid(): string {
  return crypto.randomUUID()
}

export function sessionId(prefix = "ses"): string {
  const hex = Math.random().toString(16).slice(2, 14)
  return `${prefix}_${hex}`
}

// ── CC hook payloads ───────────────────────────────────────────────

export function hookSessionStart(overrides?: Record<string, unknown>) {
  return {
    hook_event_name: "SessionStart",
    session_id: sessionId(),
    transcript_path: "/tmp/cc-transcript.jsonl",
    cwd: "/home/user/project",
    source: "claude-code",
    ...overrides,
  }
}

export function hookActivityStart(sessionId: string, tool: string, overrides?: Record<string, unknown>) {
  return {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    transcript_path: `/tmp/cc-transcript-${sessionId}.jsonl`,
    tool_name: tool,
    tool_input: JSON.stringify({ command: "echo test" }),
    ...overrides,
  }
}

export function hookActivityEnd(sessionId: string, tool: string, overrides?: Record<string, unknown>) {
  return {
    hook_event_name: "PostToolUse",
    session_id: sessionId,
    transcript_path: `/tmp/cc-transcript-${sessionId}.jsonl`,
    tool_name: tool,
    tool_result: JSON.stringify({ exit_code: 0, output: "ok" }),
    ...overrides,
  }
}

export function hookSessionEnd(sessionId: string, overrides?: Record<string, unknown>) {
  return {
    hook_event_name: "SessionEnd",
    session_id: sessionId,
    transcript_path: `/tmp/cc-transcript-${sessionId}.jsonl`,
    ...overrides,
  }
}

export function hookTokenUsage(sessionId: string, input: number, output: number, overrides?: Record<string, unknown>) {
  return {
    hook_event_name: "TokenUpdate",
    session_id: sessionId,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: 0,
    ...overrides,
  }
}

export function hookRename(sessionId: string, label: string, overrides?: Record<string, unknown>) {
  return {
    hook_event_name: "SessionRename",
    session_id: sessionId,
    label,
    ...overrides,
  }
}

// ── Task (parent/child) ────────────────────────────────────────────

export function hookTaskStart(parentSessionId: string, toolUseId: string, overrides?: Record<string, unknown>) {
  return {
    hook_event_name: "PreToolUse",
    session_id: parentSessionId,
    tool_name: "Task",
    tool_use_id: toolUseId,
    tool_input: JSON.stringify({ task: "do something" }),
    ...overrides,
  }
}

export function hookTaskEnd(parentSessionId: string, toolUseId: string, overrides?: Record<string, unknown>) {
  return {
    hook_event_name: "PostToolUse",
    session_id: parentSessionId,
    tool_name: "Task",
    tool_use_id: toolUseId,
    tool_result: JSON.stringify({ summary: "done" }),
    ...overrides,
  }
}

// ── OC plugin events ───────────────────────────────────────────────

export function ocSessionCreated(cwd = "/home/user/project", overrides?: Record<string, unknown>) {
  return {
    type: "session.created",
    session_id: sessionId("oc"),
    cwd,
    model: "deepseek-v4-flash",
    ...overrides,
  }
}

export function ocToolStart(sessionId: string, tool: string, overrides?: Record<string, unknown>) {
  return {
    type: "tool.start",
    session_id: sessionId,
    tool,
    seq: 1,
    args: {},
    ...overrides,
  }
}

export function ocToolEnd(sessionId: string, tool: string, overrides?: Record<string, unknown>) {
  return {
    type: "tool.end",
    session_id: sessionId,
    tool,
    seq: 1,
    ...overrides,
  }
}

export function ocTokens(sessionId: string, input: number, output: number, overrides?: Record<string, unknown>) {
  return {
    type: "tokens",
    session_id: sessionId,
    raw_in: input,
    raw_out: output,
    cache_read: 0,
    cumul_in: input,
    cumul_out: output,
    ...overrides,
  }
}

// ── Pre-built scenarios ────────────────────────────────────────────

export function fullAgentLifecycle(overrides?: Record<string, unknown>) {
  const sid = sessionId()
  return [
    hookSessionStart({ session_id: sid, ...overrides }),
    hookRename(sid, "my-agent"),
    hookTokenUsage(sid, 100, 50),
    hookActivityStart(sid, "Bash"),
    hookActivityEnd(sid, "Bash"),
    hookTokenUsage(sid, 200, 100),
    hookActivityStart(sid, "Read"),
    hookActivityEnd(sid, "Read"),
    hookSessionEnd(sid),
  ]
}

export function parentChildChain() {
  const parentSid = sessionId("parent")
  const childSid = sessionId("child")
  const toolUseId = crypto.randomUUID()
  return {
    parentSid,
    childSid,
    events: [
      hookSessionStart({ session_id: parentSid, label: "parent" }),
      hookRename(parentSid, "parent-task"),
      hookTaskStart(parentSid, toolUseId),
      hookSessionStart({ session_id: childSid, parent_session_id: parentSid, label: "child" }),
      hookActivityStart(childSid, "Bash"),
      hookActivityEnd(childSid, "Bash"),
      hookSessionEnd(childSid),
      hookTaskEnd(parentSid, toolUseId),
      hookTokenUsage(parentSid, 500, 250),
      hookSessionEnd(parentSid),
    ],
  }
}
