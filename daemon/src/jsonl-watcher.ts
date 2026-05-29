import * as fs from "fs";
import * as path from "path";
import { AgentId } from "./agent-id";
import type { AgentEvent, EventHandler } from "./types";
import type { Logger } from "./logger";
import { lookupContextLimit } from "./pricing";

// ── Type aliases for decoder function signatures ───────────────────

export type LineDecoder = (
  transcriptPath: string,
  source: string,
  json: Record<string, unknown>,
) => AgentEvent[];

export type LabelDeriver = (filePath: string, cwd: string) => string;

export type SessionEndChecker = (tail: Uint8Array) => boolean;

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_INITIAL_WINDOW_MS = 3600 * 1000; // 1 hour
const STARTUP_STALE_MINUTES = 5;
const MAX_PENDING_BYTES = 1 << 20; // 1 MB
const TAIL_BYTES = 8192;
const PERIODIC_SCAN_MS = 60 * 1000; // 60 seconds

// ── JsonlWatcher ───────────────────────────────────────────────────

export class JsonlWatcher {
  private cursors: Map<string, number> = new Map();
  private seen: Set<string> = new Set();
  private initialWindowMs: number = DEFAULT_INITIAL_WINDOW_MS;
  private logger: Logger;

  private constructor(
    private root: string,
    private sourceName: string,
    private decodeLine: LineDecoder,
    private deriveLabel: LabelDeriver,
    private checkEnded: SessionEndChecker,
    logger?: Logger,
  ) {
    this.logger = logger ?? { verbose: () => {}, info: console.log, warn: console.warn, error: console.error };
  }

  static new(
    root: string,
    source: string,
    decodeLine: LineDecoder,
    deriveLabel: LabelDeriver,
    checkEnded: SessionEndChecker,
    logger?: Logger,
  ): JsonlWatcher {
    return new JsonlWatcher(root, source, decodeLine, deriveLabel, checkEnded, logger);
  }

  withInitialWindow(windowMs: number): this {
    this.initialWindowMs = windowMs;
    return this;
  }

  withLogger(logger: Logger): this {
    this.logger = logger;
    return this;
  }

  async run(emit: EventHandler): Promise<void> {
    this.logger.verbose(`[jsonl] ${this.sourceName} watcher starting: ${this.root}`);
    await this.ensureDir(this.root);
    await this.initialSeed(emit);

    // Periodic scan for new files (handles what fs.watch might miss)
    const scanTimer = setInterval(() => {
      this.scanRoot(emit);
    }, PERIODIC_SCAN_MS);

    // File system watcher
    let watcher: fs.FSWatcher | null = null;
    try {
      watcher = fs.watch(this.root, { recursive: true }, (_event, filename) => {
        if (filename && filename.endsWith(".jsonl")) {
          const fullPath = path.join(this.root, filename);
          this.logger.verbose(`[jsonl] change: ${filename}`);
          this.walkFile(fullPath, emit);
        }
      });
    } catch (e) {
      this.logger.warn("fs.watch not available (falling back to periodic scan):", e);
    }

    // Wait for abort signal
    await new Promise<void>(() => {
      // Keep running until process exits
    });

    scanTimer.unref();
    watcher?.close();
  }

  // ── Initial seed ──────────────────────────────────────────────────

  private async initialSeed(emit: EventHandler): Promise<void> {
    await this.walkDir(this.root, emit, true);
  }

  private async walkDir(dir: string, emit: EventHandler, isSeed: boolean): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walkDir(fullPath, emit, isSeed);
      } else if (entry.name.endsWith(".jsonl")) {
        if (isSeed) {
          await this.seedFile(fullPath, emit);
        } else {
          this.walkFile(fullPath, emit);
        }
      }
    }
  }

  private async seedFile(filePath: string, emit: EventHandler): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return;
    }

    const ageMs = Date.now() - stat.mtimeMs;
    const ageMin = ageMs / 60000;
    const sizeKb = stat.size / 1024;
    const recent = ageMs <= this.initialWindowMs;

    if (recent) {
      const staleMinutes = ageMs / 60000;
      const ended = await this.checkSessionEnded(filePath) || staleMinutes >= STARTUP_STALE_MINUTES;
      if (ended) {
        this.logger.verbose(`[jsonl] seed ${path.basename(filePath)} — ended (${ageMin.toFixed(0)}m old, ${sizeKb.toFixed(0)}KB)`);
        this.cursors.set(filePath, stat.size);
      } else {
        this.logger.verbose(`[jsonl] seed ${path.basename(filePath)} — active session (${ageMin.toFixed(0)}m old, ${sizeKb.toFixed(0)}KB)`);
        this.walkFile(filePath, emit);
      }
    } else {
      this.logger.verbose(`[jsonl] seed ${path.basename(filePath)} — skipped (${ageMin.toFixed(0)}m > ${this.initialWindowMs / 60000}h window)`);
      this.cursors.set(filePath, stat.size);
    }
  }

  // ── Check session ended ──────────────────────────────────────────

  private async checkSessionEnded(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(filePath);
      const fileLen = stat.size;
      const start = Math.max(0, fileLen - TAIL_BYTES);
      const fd = await fs.promises.open(filePath, "r");
      const buf = new Uint8Array(fileLen - start);
      await fd.read(buf, 0, buf.length, start);
      await fd.close();
      return this.checkEnded(buf);
    } catch {
      return false;
    }
  }

  // ── Walk a single .jsonl file ────────────────────────────────────

  private async walkFile(filePath: string, emit: EventHandler): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return;
    }

    if (stat.isDirectory()) return;
    if (!filePath.endsWith(".jsonl")) return;

    const fileLen = stat.size;
    const cursorNow = this.cursors.get(filePath) ?? 0;

    if (cursorNow > fileLen) {
      this.logger.warn(`${filePath} truncated below cursor (${fileLen} < ${cursorNow}), resetting cursor`);
      this.cursors.set(filePath, 0);
      return;
    }

    if (cursorNow === fileLen) return;

    if (fileLen - cursorNow > MAX_PENDING_BYTES) {
      this.logger.warn(`${filePath} has > ${MAX_PENDING_BYTES} pending bytes with no newline`);
      this.cursors.set(filePath, fileLen);
      return;
    }

    // Read new bytes
    const chunkSize = fileLen - cursorNow;
    const buf = new Uint8Array(chunkSize);
    let fd: fs.promises.FileHandle | null = null;
    try {
      fd = await fs.promises.open(filePath, "r");
      await fd.read(buf, 0, buf.length, cursorNow);
    } catch (e) {
      console.warn(`read ${filePath} failed:`, e);
      return;
    } finally {
      await fd?.close();
    }

    // Find safe end at last newline
    let safeEndRelative = 0;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i] === 0x0a) {
        safeEndRelative = i + 1;
        break;
      }
    }
    if (safeEndRelative === 0) return;

    const newCursor = cursorNow + safeEndRelative;
    this.cursors.set(filePath, newCursor);

    const newBytes = buf.subarray(0, safeEndRelative);
    const transcriptPathStr = filePath;

    this.logger.verbose(`[jsonl] ${path.basename(filePath)}: cursor ${cursorNow} → ${newCursor}/${fileLen} (${safeEndRelative}B new)`);

    // First time seeing this file → emit SessionStart
    if (!this.seen.has(filePath)) {
      this.seen.add(filePath);
      const id = AgentId.fromParts(this.sourceName, transcriptPathStr);
      const sessionId = path.basename(filePath, ".jsonl");
      const cwd = extractCwd(newBytes) ?? "";
      const parentId = detectParentId(filePath, this.sourceName);

      const label = this.deriveLabel(filePath, cwd);
      const shortSession = sessionId.length > 16 ? sessionId.slice(0, 16) + "…" : sessionId;
      this.logger.verbose(`[jsonl] session ${shortSession} "${label}"${parentId ? " (subagent)" : ""} id=${sessionId}`);

      emit("jsonl", {
        type: "sessionStart",
        agentId: id,
        source: this.sourceName,
        sessionId,
        cwd,
        parentId: parentId ?? null,
        agentType: null,
        contextWindowLimit: lookupContextLimit(null),
      });

      emit("jsonl", {
        type: "rename",
        agentId: id,
        label,
      });
    }

    // Decode each line
    const text = new TextDecoder().decode(newBytes);
    let lineCount = 0;
    let eventCount = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      lineCount++;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || Array.isArray(parsed)) continue;

      try {
        const events = this.decodeLine(transcriptPathStr, this.sourceName, parsed);
        eventCount += events.length;
        for (const ev of events) {
          emit("jsonl", ev);
        }
      } catch (e) {
        this.logger.warn(`decode error in ${filePath}:`, e);
      }
    }

    if (lineCount > 0) {
      this.logger.verbose(`[jsonl] ${path.basename(filePath)}: ${lineCount} lines → ${eventCount} events`);
    }
  }

  // ── Periodic scan ────────────────────────────────────────────────

  private async scanRoot(emit: EventHandler): Promise<void> {
    await this.walkDir(this.root, emit, false);
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private async ensureDir(dir: string): Promise<void> {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch {
      // directory exists
    }
  }
}

// ── Free functions ─────────────────────────────────────────────────

function detectParentId(filePath: string, source: string): AgentId | null {
  const idx = filePath.indexOf("/subagents/");
  if (idx === -1) return null;
  const parentDir = filePath.slice(0, idx);
  const parentJsonl = `${parentDir}.jsonl`;
  return AgentId.fromParts(source, parentJsonl);
}

function extractCwd(bytes: Uint8Array): string | null {
  const text = new TextDecoder().decode(bytes);
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === "object" && typeof parsed.cwd === "string") {
        return parsed.cwd;
      }
    } catch {
      continue;
    }
  }
  return null;
}
