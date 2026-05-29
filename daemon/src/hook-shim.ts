import * as net from "net";

const stdin = await Bun.stdin.text();
try {
  const payload = {
    ...JSON.parse(stdin),
    _shim_ts_ms: Date.now(),
  };
  const socketPath =
    process.env.AGENTS_OFFICE_SOCKET ??
    (process.env.XDG_RUNTIME_DIR
      ? `${process.env.XDG_RUNTIME_DIR}/agents-office.sock`
      : `/tmp/agents-office-${process.getuid?.() ?? 0}.sock`);

  const data = JSON.stringify(payload) + "\n";
  await new Promise<void>((resolve) => {
    const socket = net.createConnection(socketPath);
    socket.setTimeout(200);
    socket.on("connect", () => {
      socket.write(data, () => {
        socket.end();
        resolve();
      });
    });
    socket.on("error", () => resolve());
    socket.on("timeout", () => { socket.destroy(); resolve(); });
  });
} catch {
  // Always exit 0 — never block CC.
}
process.exit(0);
