# Drizzle ORM, Versioned DB Migrations, CI Schema Drift Check

## Problem

`agents-office --doctor` (and the daemon at startup) failed with:

```
SQLiteError: table raw_events has no column named transport
```

The schema was upgraded to add a `transport` column to `raw_events`, but existing
SQLite databases were never migrated — `CREATE TABLE IF NOT EXISTS` is a no-op
when the table already exists (without the new column).

## Solution: Drizzle ORM + versioned migration framework

### Architecture

```
daemon/src/db/
├── schema.ts          — 4 Drizzle table definitions (single source of truth)
├── index.ts           — createDb(): Database init + migration + drizzle instance
├── migrate.ts         — Version-based migration runner (PRAGMA user_version)
├── migrations.ts      — Versioned migration definitions [{version, description, up[]}]
├── migrate.test.ts    — 3 migration test scenarios
├── effect.ts          — DrizzleClient Effect Context.Tag
daemon/drizzle/        — Generated migration meta (tracked in git for drift detection)
daemon/drizzle.config.ts — Drizzle Kit config
```

### Migration framework

Instead of ad-hoc `PRAGMA table_info` checks, migrations use `PRAGMA user_version`:

```
startup:
  PRAGMA user_version → read current version (default 0)
  if version < 1:
    PRAGMA table_info(raw_events) → if has "id" but no "transport"
      → DROP TABLE raw_events  (handles legacy DBs)
    CREATE TABLE IF NOT EXISTS all 4 tables
    PRAGMA user_version = 1
```

### New CLI command: `agents-office db-migrate`

Standalone command to apply migrations without starting the daemon:

```bash
./agents-office db-migrate --db ~/.agents-office/sessions.db
```

### Changes by file

| File | Change |
|------|--------|
| `daemon/src/main.ts` | Added `db-migrate` CLI command; fixed server lifecycle scoping bug |
| `daemon/src/server/http.ts` | Replaced raw `bun:sqlite` prepared stmts with Drizzle typed queries; removed `Effect.scoped`/`addFinalizer` → `Effect.acquireRelease` in caller |
| `daemon/src/services/session-store.ts` | Replaced `@effect/sql` tagged templates with Drizzle query builder + `Effect.sync()` wrappers; `SessionRow` inferred via `InferSelectModel` |
| `daemon/src/services/database.ts` | Simplified to delegate to Drizzle migration runner |
| `daemon/src/services/session-store.test.ts` | Rewritten with Drizzle test DB (`:memory:`) |
| `daemon/package.json` | `+drizzle-orm`, `+drizzle-kit`; `-@effect/sql`, `-@effect/sql-sqlite-bun` |
| `.github/workflows/ci.yml` | `ci` job: added schema drift check. `release` job: added binary migration test |
| `scripts/preflight.sh` | Added schema drift check |
| `daemon/drizzle/meta/` | Committed as git-tracked schema baseline for drift detection |

### New files

| File | Purpose |
|------|---------|
| `daemon/src/db/schema.ts` | 4 Drizzle table definitions |
| `daemon/src/db/index.ts` | `createDb()` factory |
| `daemon/src/db/migrate.ts` | Version-based migration runner |
| `daemon/src/db/migrations.ts` | Migration definitions array |
| `daemon/src/db/migrate.test.ts` | 3 test scenarios (fresh DB, legacy, idempotent) |
| `daemon/src/db/effect.ts` | Drizzle Effect Context.Tag |
| `daemon/src/cli/db-migrate.ts` | Standalone `db-migrate` CLI command |
| `daemon/drizzle.config.ts` | Drizzle Kit config |
| `scripts/check-db-schema.sh` | Schema drift detection script |
| `scripts/test-binary-migration.sh` | Binary-level migration test script |

### Bug fixes

1. **Pre-existing `Bun.serve` scoping bug**: `Effect.scoped` + `Effect.addFinalizer(server.stop)` in `makeDaemon()` caused the HTTP server to stop immediately after starting, because the scope closed when `makeDaemon()` returned. Fixed by using `Effect.acquireRelease` in `runDaemon()` instead.

2. **Leftover `storeRaw.run()` reference**: The websocket message handler in `http.ts` still referenced the old prepared statement variable after the Drizzle refactor removed it.

### Developer workflow for future schema changes

```
1. Edit daemon/src/db/schema.ts
2. bunx drizzle-kit generate        → creates drizzle/0001_xxx.sql
3. Copy SQL into migrations.ts as version 2 entry
4. Commit schema.ts + drizzle/ + migrations.ts
5. CI: tests pass + drift check passes + binary migration test passes
```

### Test results

```
127/127 tests pass
✓ Schema drift check: clean
✓ Binary migration test: legacy DB upgraded, transport column added
```

### CI pipeline additions

- **`ci` job**: `bash scripts/check-db-schema.sh` after unit tests
- **`release` job**: `bash scripts/test-binary-migration.sh` after binary builds
- **Pre-push**: Schema drift check in `scripts/preflight.sh`

### Release impact

- Users running `brew install agents-office` or `curl ... | bash` get a fresh DB with correct schema automatically
- Users upgrading from v0.1.31 (or older) get their `raw_events` table migrated on first daemon startup
- Manual DB migration: `agents-office db-migrate --db <path>`
