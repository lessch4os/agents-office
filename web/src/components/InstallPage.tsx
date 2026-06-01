const styles = {
  container: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "20px 0",
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    lineHeight: 1.6,
  },
  h1: { fontSize: 18, fontWeight: 600, margin: "0 0 16px", color: "var(--text-primary)" },
  h2: { fontSize: 14, fontWeight: 600, margin: "24px 0 8px", color: "var(--text-primary)" },
  code: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "8px 12px",
    display: "block",
    whiteSpace: "pre" as const,
    overflowX: "auto" as const,
    fontSize: 12,
    lineHeight: 1.5,
    margin: "6px 0",
  },
  inline: {
    background: "var(--bg-surface)",
    borderRadius: 3,
    padding: "1px 5px",
    fontSize: 12,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 12,
    margin: "8px 0",
  },
  th: {
    textAlign: "left" as const,
    borderBottom: "1px solid var(--border-subtle)",
    padding: "6px 8px",
    color: "var(--text-on-surface-subtle)",
    fontWeight: 500,
  },
  td: {
    borderBottom: "1px solid var(--border-subtle)",
    padding: "6px 8px",
    color: "var(--text-on-surface)",
  },
  tag: {
    background: "rgba(0,229,255,0.12)",
    color: "#00e5ff",
    borderRadius: 3,
    padding: "1px 6px",
    fontSize: 10,
    marginRight: 4,
  },
};

const commands = [
  { cmd: "agents-office", desc: "Start the daemon", example: "--port 8080 --password secret" },
  { cmd: "agents-office doctor", desc: "Run diagnostics", example: "" },
  { cmd: "agents-office reload", desc: "Gracefully restart CC/OC + daemon", example: "--daemon-only" },
  { cmd: "agents-office install", desc: "Install CC hooks + OC plugin", example: "" },
  { cmd: "agents-office install-hooks", desc: "Install Claude Code hooks only", example: "" },
  { cmd: "agents-office install-opencode", desc: "Install OpenCode plugin only", example: "" },
  { cmd: "agents-office-forwarder", desc: "Forward local hooks to remote server", example: "--server wss://host/hook --password secret" },
];

export default function InstallPage() {
  return (
    <div style={styles.container}>
      <h1 style={styles.h1}>Install & Commands</h1>

      <h2 style={styles.h2}>Server (Ubuntu / Debian)</h2>
      <p style={{ margin: 0, color: "var(--text-on-surface)" }}>
        One-command setup &mdash; downloads the prebuilt binary, creates a systemd service:
      </p>
      <div style={styles.code}>curl -fsSL https://raw.githubusercontent.com/lessch4os/agents-office/main/scripts/install-server.sh | bash</div>
      <p style={{ margin: "4px 0", color: "var(--text-on-surface-muted)", fontSize: 12 }}>
        No Bun dependency. The binary is downloaded from GitHub Releases.
      </p>

      <h2 style={styles.h2}>macOS (Homebrew)</h2>
      <div style={styles.code}>brew tap lessch4os/agents-office{'\n'}brew install agents-office{'\n'}brew services start agents-office</div>
      <p style={{ margin: "4px 0", color: "var(--text-on-surface-muted)", fontSize: 12 }}>
        Upgrade: <span style={styles.inline}>brew upgrade agents-office && brew services restart agents-office</span>
      </p>

      <h2 style={styles.h2}>Any platform (npm fallback)</h2>
      <p style={{ margin: 0, color: "var(--text-on-surface)" }}>
        Requires Bun installed:
      </p>
      <div style={styles.code}>npm install -g @lessch4os/agents-office{'\n'}agents-office --port 8080</div>
      <p style={{ margin: "4px 0", color: "var(--text-on-surface-muted)", fontSize: 12 }}>
        Upgrade: <span style={styles.inline}>npm update -g @lessch4os/agents-office</span>
      </p>

      <h2 style={styles.h2}>All Commands</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Command</th>
            <th style={styles.th}>Description</th>
            <th style={styles.th}>Example</th>
          </tr>
        </thead>
        <tbody>
          {commands.map((c) => (
            <tr key={c.cmd}>
              <td style={styles.td}><span style={styles.inline}>{c.cmd}</span></td>
              <td style={styles.td}>{c.desc}</td>
              <td style={styles.td}>{c.example && <span style={styles.tag}>{c.example}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={styles.h2}>Daemon Options</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Flag</th>
            <th style={styles.th}>Default</th>
            <th style={styles.th}>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["--port", "8080", "HTTP/WebSocket listen port"],
            ["--max-desks", "16", "Number of agent desks"],
            ["--password", "—", "Auth password (enables login + hook auth)"],
            ["--username", "agents-office", "Login username"],
            ["--relay-to", "—", "Forward events to remote server"],
            ["--socket", "/tmp/agents-office-{uid}.sock", "Unix socket path for hook shim"],
            ["--db", "~/.agents-office/sessions.db", "SQLite database path"],
            ["--verbose, -v", "—", "Verbose logging"],
            ["--install", "—", "Install hooks + OC plugin"],
            ["--doctor", "—", "Run diagnostics"],
            ["--reload", "—", "Restart CC/OC + daemon"],
          ].map(([flag, def, desc]) => (
            <tr key={flag}>
              <td style={styles.td}><span style={styles.inline}>{flag}</span></td>
              <td style={{ ...styles.td, color: "var(--text-on-surface-muted)" }}>{def}</td>
              <td style={styles.td}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={styles.h2}>Environment Variables</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Variable</th>
            <th style={styles.th}>Purpose</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["AGENTS_OFFICE_PASSWORD", "Auth password"],
            ["AGENTS_OFFICE_SERVER", "Remote server URL (forwarder)"],
            ["AGENTS_OFFICE_SOCKET", "Override Unix socket path"],
            ["AGENTS_OFFICE_DB", "Override SQLite database path"],
            ["AGENTS_OFFICE_PORT", "Override listen port"],
            ["AGENTS_OFFICE_USERNAME", "Login username"],
            ["AGENTS_OFFICE_RELAY_TO", "Relay target URL"],
            ["AGENTS_OFFICE_VERBOSE", "Enable verbose logging (forwarder)"],
          ].map(([name, desc]) => (
            <tr key={name}>
              <td style={styles.td}><span style={styles.inline}>{name}</span></td>
              <td style={styles.td}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
