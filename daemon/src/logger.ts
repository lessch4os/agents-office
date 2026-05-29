import * as fs from "fs";
import * as path from "path";

export interface Logger {
  verbose: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(verbose: boolean): Logger {
  return {
    verbose: verbose ? console.log : () => {},
    info: console.log,
    warn: console.warn,
    error: console.error,
  };
}

export function createFileAppender(filePath: string): (line: string) => void {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch {}
  return (line: string) => {
    try { fs.appendFileSync(filePath, `[${new Date().toISOString()}] ${line}\n`); } catch {}
  };
}
