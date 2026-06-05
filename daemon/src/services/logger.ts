import fs from "fs"
import path from "path"

export const LOG_LEVELS = {
  error: 1,
  warn: 3,
  info: 5,
  debug: 7,
  trace: 10,
} as const

export type LogLevel = keyof typeof LOG_LEVELS
export type LogComponent = "daemon" | "forwarder" | "setup" | "doctor" | "reload" | "db-migrate" | "hook-socket" | "jsonl" | "reducer"

export interface LogEntry {
  ts: string
  level: number
  component: string
  msg: string
  [key: string]: unknown
}

export class Logger {
  private minLevel: number
  private componentFilter: Set<string> | null
  private fileAppender: ((entry: LogEntry) => void) | null = null

  constructor(minLevel = 3, componentFilter: string | null = null) {
    this.minLevel = minLevel
    this.componentFilter = componentFilter
      ? new Set(componentFilter === "all" ? [] : componentFilter.split(","))
      : null
  }

  setFileAppender(logDir: string): void {
    try { fs.mkdirSync(logDir, { recursive: true }) } catch {}
    const logFile = path.join(logDir, "daemon.log")
    this.fileAppender = (entry) => {
      try { fs.appendFileSync(logFile, JSON.stringify(entry) + "\n") } catch {}
    }
  }

  private log(level: number, component: string, msg: string, extra?: Record<string, unknown>): void {
    if (level > this.minLevel) return
    if (this.componentFilter && !this.componentFilter.has(component)) return

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      component,
      msg,
      ...extra,
    }
    const line = JSON.stringify(entry)
    if (level <= 3) process.stderr.write(line + "\n")
    else if (level <= 5) process.stderr.write(line + "\n")
    else if (this.minLevel >= 7) process.stderr.write(line + "\n")
    this.fileAppender?.(entry)
  }

  error(msg: string, extra?: Record<string, unknown>): void { this.log(1, "daemon", msg, extra) }
  warn(msg: string, extra?: Record<string, unknown>): void { this.log(3, "daemon", msg, extra) }
  info(msg: string, extra?: Record<string, unknown>): void { this.log(5, "daemon", msg, extra) }
  debug(msg: string, extra?: Record<string, unknown>): void { this.log(7, "daemon", msg, extra) }
  trace(msg: string, extra?: Record<string, unknown>): void { this.log(10, "daemon", msg, extra) }

  child(component: string): Logger {
    const child = new Logger()
    child.minLevel = this.minLevel
    child.componentFilter = this.componentFilter
    child.fileAppender = this.fileAppender
    const origLog = child.log.bind(child)
    child.log = (level, _comp, msg, extra) => origLog(level, component, msg, extra)
    return child
  }
}

let globalLogger: Logger | null = null

export function getLogger(): Logger {
  if (!globalLogger) globalLogger = new Logger()
  return globalLogger
}

export function setLogger(logger: Logger): void {
  globalLogger = logger
}
