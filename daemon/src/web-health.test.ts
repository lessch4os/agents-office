import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { resolve } from "path";

const PORT = 23457;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const LOGIN_URL = `http://127.0.0.1:${PORT}/login`;
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
    "bun", "run", DAEMON_SCRIPT, "--port", String(PORT),
    ...(webRootFound ? ["--web-root", WEB_ROOT] : []),
  ], {
    env: { ...process.env, AGENTS_OFFICE_DB: ":memory:" },
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
  const body = await r.text();
  expect(body.trim()).toBe("ok");
});

test("daemon serves login page (built-in, no web-root needed)", async () => {
  const r = await fetch(LOGIN_URL);
  expect(r.ok).toBe(true);
  const body = await r.text();
  expect(body).toContain("<!DOCTYPE html>");
});

test("daemon serves index.html from web-root", async () => {
  if (!webRootFound) return;
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  expect(r.ok).toBe(true);
  const body = await r.text();
  expect(body).toContain("<!DOCTYPE html>");
});
