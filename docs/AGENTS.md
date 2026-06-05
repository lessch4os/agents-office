# agents-office reference

## Logging

All log output is **JSON Lines** written to stderr. Pipe with `jq` for filtering:

```bash
agents-office daemon --log 10 2>&1 | jq 'select(.level >= 5) | {ts, msg}'
```

### Log levels

```
--log <level>    Log verbosity (1-10, default: 3)
--log-type <f>   Component filter (all,daemon,forwarder,doctor,setup)
--verbose        Shorthand for --log 10
```

| Level | Name  | Default | When shown             |
|-------|-------|---------|------------------------|
| 1     | error | always  | Daemon crashes, DB errors |
| 3     | warn  | default | Dropped events, mild issues |
| 5     | info  | opt-in  | Server start, socket created, forwarder connected |
| 7     | debug | opt-in  | Event processing, WebSocket messages, broadcast ticks |
| 10    | trace | opt-in  | Raw event payloads, full forwarder traffic |

### Log entry format

Every line is a complete JSON object:

```json
{"ts":"2026-06-05T17:30:00.000Z","level":5,"component":"daemon","msg":"daemon running","port":8080}
```

**Fields:**
- `ts` — ISO 8601 timestamp
- `level` — Numeric log level (1-10)
- `component` — Source: `daemon`, `forwarder`, `hook-socket`, `reducer`, etc.
- `msg` — Human-readable message
- Additional fields vary by event (e.g. `sessionId`, `agentId`, `error`)

### Examples

Debug event flow:
```bash
agents-office daemon --log 7 2>&1 | jq 'select(.component == "daemon") | {ts, msg, sessionId, type}'
```

See only warnings and errors:
```bash
agents-office daemon 2>&1 | jq 'select(.level <= 3)'
```

Forwarder traffic only:
```bash
agents-office forwarder --server wss://host/hook --password secret 2>&1
# Uses --log-type=all by default, logger.component == "forwarder"
```

## Database

```bash
agents-office db-migrate                # Apply pending migrations
agents-office db-migrate --db <path>    # Migrate specific database
```

## Forwarder

```bash
agents-office forwarder \
  --server wss://playground-agents-office.lessch4os.com/hook \
  --password <password>
```

### Config difference

The **forwarder** reads `server_url` and `password` from `~/.agents-office/config.json`
so they can be set once via `agents-office setup` instead of passing CLI flags every time.

The **daemon** does NOT read config.json — it only uses CLI flags and environment variables.
This means daemon settings (like `--port`, `--password`, `--web-root`) must be provided
each time or configured in the systemd service file.

## Commands

| Command | Description |
|---------|-------------|
| `daemon` | Start the HTTP/WS server (default) |
| `forwarder` | Forward local hook events to remote server |
| `doctor` | Run diagnostics |
| `db-migrate` | Apply pending database migrations |
| `setup` | Interactive config wizard |
| `reload` | Graceful restart agents + daemon |
