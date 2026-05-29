// End-to-end test: daemon → WebSocket → hook payload → agent appears
import { spawn } from "bun";
import * as net from "net";

const PORT = 8084;
const SOCKET_PATH = `/tmp/agents-office-e2e-${process.pid}.sock`;
const PROJECTS_ROOT = `/tmp/agents-office-e2e-projects-${process.pid}`;

async function waitForHealth(url: string, maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error(`health check failed after ${maxRetries} retries`);
}

async function sendHookPayload(socketPath: string, payload: object) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const data = JSON.stringify(payload) + "\n";
    socket.on("connect", () => {
      socket.write(data, () => {
        socket.end();
        resolve();
      });
    });
    socket.on("error", (err) => {
      // Don't reject — hook shim must never fail CC
      console.warn("socket error:", err.message);
      resolve();
    });
    setTimeout(() => resolve(), 2000);
  });
}

async function main() {
  // Cleanup
  try { Bun.spawnSync(["rm", "-rf", PROJECTS_ROOT]); } catch {}
  try { Bun.spawnSync(["mkdir", "-p", PROJECTS_ROOT]); } catch {}
  try { Bun.spawnSync(["rm", "-f", SOCKET_PATH]); } catch {}

  // 1. Start daemon
  const daemonDir = import.meta.dir!.replace(/\/src$/, "");
  const daemon = spawn([
    "bun", "run", "src/main.ts",
    "--port", String(PORT),
    "--socket", SOCKET_PATH,
    "--projects-root", PROJECTS_ROOT,
    "--max-desks", "4",
  ], {
    cwd: daemonDir,
    env: { ...process.env, AGENTS_OFFICE_SOCKET: SOCKET_PATH },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Don't buffer stdout/stderr — let them flow to debug issues
  (async () => {
    const reader = daemon.stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      console.log("[daemon]", decoder.decode(value).trimEnd());
    }
  })();
  (async () => {
    const reader = daemon.stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      console.error("[daemon:err]", decoder.decode(value).trimEnd());
    }
  })();

  let passed = 0;
  let failed = 0;

  function assert(label: string, ok: boolean) {
    if (ok) { console.log(`  ✓ ${label}`); passed++; }
    else { console.log(`  ✗ ${label}`); failed++; }
  }

  // 2. Wait for daemon to be ready
  console.log("waiting for daemon...");
  await waitForHealth(`http://localhost:${PORT}/health`);
  console.log("daemon ready");

  // 3. Connect WebSocket
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const received: any[] = [];

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      console.log("WebSocket connected");
      resolve();
    };
    ws.onerror = () => reject(new Error("ws connect failed"));
    setTimeout(() => reject(new Error("ws timeout")), 5000);
  });

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data as string);
    received.push(data);
  };

  // 4. Wait for initial broadcast
  await Bun.sleep(500);

  // 5. Test initial state
  console.log("\ntest: initial state");
  assert("received at least 1 broadcast", received.length >= 1);
  const initial = received[0];
  assert("has agents field", "agents" in initial);
  assert("max_desks is 4", initial.max_desks === 4);
  assert("now_ms is set", typeof initial.now_ms === "number");
  assert("agents is empty", Object.keys(initial.agents).length === 0);

  // 6. Send SessionStart hook payload
  console.log("\ntest: SessionStart hook");
  await sendHookPayload(SOCKET_PATH, {
    hook_event_name: "SessionStart",
    session_id: "test-session-1",
    transcript_path: "/tmp/test-transcript.jsonl",
    cwd: "/home/user/project",
    source: "claude-code",
    timestamp: new Date().toISOString(),
  });
  await Bun.sleep(1000);

  const afterSession = received[received.length - 1];
  const agents = Object.values(afterSession.agents) as any[];
  assert("at least 1 agent present", agents.length >= 1);
  const agent = agents.find((a: any) => a.session_id === "test-session-1");
  assert("agent with test-session-1 found", !!agent);
  assert("agent label is project (basename of cwd)", agent?.label === "project");
  assert("agent state is Idle", agent?.state?.type === "Idle");
  assert("agent desk_index is 0", agent?.desk_index === 0);
  assert("source is claude-code", agent?.source === "claude-code");

  const agentId = agent?.agent_id;
  assert("agent_id is a number", typeof agentId === "number");

  // 7. Send PreToolUse
  console.log("\ntest: PreToolUse hook");
  await sendHookPayload(SOCKET_PATH, {
    hook_event_name: "PreToolUse",
    session_id: "test-session-1",
    transcript_path: "/tmp/test-transcript.jsonl",
    tool_use_id: "tool-1",
    tool_name: "Bash",
    tool_input: { command: "ls -la" },
    timestamp: new Date().toISOString(),
  });
  await Bun.sleep(1000);

  const afterTool = received[received.length - 1];
  const activeAgent = Object.values(afterTool.agents).find(
    (a: any) => a.session_id === "test-session-1"
  ) as any;
  assert("agent state is Active", activeAgent?.state?.type === "Active");
  assert("activity is typing", activeAgent?.state?.activity === "typing");
  assert("tool_use_id is tool-1", activeAgent?.state?.tool_use_id === "tool-1");
  assert("current_tool is Bash", activeAgent?.current_tool === "Bash");
  assert("detail contains Bash command", activeAgent?.state?.detail?.includes("Bash: ls -la"));

  // 8. Send PostToolUse and wait for idle debounce (1500ms grace)
  console.log("\ntest: PostToolUse → idle debounce");
  await sendHookPayload(SOCKET_PATH, {
    hook_event_name: "PostToolUse",
    session_id: "test-session-1",
    transcript_path: "/tmp/test-transcript.jsonl",
    tool_use_id: "tool-1",
    tool_name: "Bash",
    timestamp: new Date().toISOString(),
  });
  await Bun.sleep(3000);

  const afterPost = received[received.length - 1];
  const idleAgent = Object.values(afterPost.agents).find(
    (a: any) => a.session_id === "test-session-1"
  ) as any;
  assert("agent returned to Idle", idleAgent?.state?.type === "Idle");
  assert("tool_call_count >= 1", (idleAgent?.tool_call_count ?? 0) >= 1);

  // 9. Cleanup
  ws.close();
  daemon.kill();
  try { Bun.spawnSync(["rm", "-f", SOCKET_PATH]); } catch {}
  try { Bun.spawnSync(["rm", "-rf", PROJECTS_ROOT]); } catch {}

  // Results
  console.log(`\n${"=".repeat(40)}`);
  console.log(`result: ${failed > 0 ? "FAILED" : "PASSED"}`);
  console.log(`  passed: ${passed}`);
  console.log(`  failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("test error:", e);
  process.exit(1);
});
