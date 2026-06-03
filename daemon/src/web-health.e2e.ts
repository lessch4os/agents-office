import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { spawn } from "bun";
import { resolve } from "path";

const PORT = 23457;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const DAEMON_SCRIPT = resolve(import.meta.dir, "main.ts");
const WEB_ROOT = resolve(import.meta.dir, "../../web/dist");

let proc: import("bun").Subprocess | null = null;
let webRootFound = false;

beforeAll(async () => {
  try {
    const f = Bun.file(`${WEB_ROOT}/index.html`);
    webRootFound = (await f.stat()).isFile;
  } catch {}

  proc = spawn([
    "bun", "run", DAEMON_SCRIPT,
    ...(webRootFound ? ["--web-root", WEB_ROOT] : []),
  ], {
    env: { ...process.env, PORT: String(PORT), AGENTS_OFFICE_DB: ":memory:" },
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const r = await fetch(HEALTH_URL);
      if (r.ok) return;
    } catch {}
  }
  throw new Error("daemon did not start within 6s");
}, 15000);

afterAll(() => {
  proc?.kill();
});

test("daemon responds to /health", async () => {
  const r = await fetch(HEALTH_URL);
  expect(r.ok).toBe(true);
  const body = await r.json();
  expect(body).toEqual({ ok: true });
});

test("daemon serves api/scene", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/scene`);
  expect(r.ok).toBe(true);
  const body = await r.json();
  expect(body).toHaveProperty("agents");
  expect(body).toHaveProperty("max_desks");
  expect(body).toHaveProperty("now_ms");
});
