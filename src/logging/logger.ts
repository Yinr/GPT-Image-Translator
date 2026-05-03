import { join } from "@std/path";
import type { LoggingConfig, LogLevel } from "../shared/types.ts";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, context?: LogContext): Promise<void>;
  info(message: string, context?: LogContext): Promise<void>;
  warn(message: string, context?: LogContext): Promise<void>;
  error(message: string, context?: LogContext): Promise<void>;
  filePath?: string;
}

export type LogContext = Record<string, unknown>;

export interface CreateLoggerOptions {
  config: LoggingConfig;
  runId?: string;
  now?: () => Date;
  writeTextFile?: typeof Deno.writeTextFile;
  mkdir?: typeof Deno.mkdir;
  consoleLog?: (message: string) => void;
  consoleWarn?: (message: string) => void;
  consoleError?: (message: string) => void;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  if (!options.config.enabled) return new NoopLogger();

  return new DefaultLogger(options);
}

export function logFilePath(
  dir: string,
  runId?: string,
  now: () => Date = () => new Date(),
): string {
  const ts = timestampFilePart(now());
  const fileName = runId ? `${ts}_${safeFilePart(runId)}.log` : `${ts}.log`;
  return join(dir, fileName);
}

class NoopLogger implements Logger {
  filePath?: string;

  debug(): Promise<void> {
    return Promise.resolve();
  }

  info(): Promise<void> {
    return Promise.resolve();
  }

  warn(): Promise<void> {
    return Promise.resolve();
  }

  error(): Promise<void> {
    return Promise.resolve();
  }
}

class DefaultLogger implements Logger {
  readonly filePath: string;
  private readonly now: () => Date;
  private readonly writeTextFile: typeof Deno.writeTextFile;
  private readonly mkdir: typeof Deno.mkdir;
  private readonly consoleLog: (message: string) => void;
  private readonly consoleWarn: (message: string) => void;
  private readonly consoleError: (message: string) => void;
  private directoryReady = false;

  constructor(private readonly options: CreateLoggerOptions) {
    this.now = options.now ?? (() => new Date());
    this.writeTextFile = options.writeTextFile ?? Deno.writeTextFile;
    this.mkdir = options.mkdir ?? Deno.mkdir;
    this.consoleLog = options.consoleLog ?? console.log;
    this.consoleWarn = options.consoleWarn ?? console.warn;
    this.consoleError = options.consoleError ?? console.error;
    this.filePath = logFilePath(options.config.dir, options.runId, this.now);
  }

  debug(message: string, context?: LogContext): Promise<void> {
    return this.write("debug", message, context);
  }

  info(message: string, context?: LogContext): Promise<void> {
    return this.write("info", message, context);
  }

  warn(message: string, context?: LogContext): Promise<void> {
    return this.write("warn", message, context);
  }

  error(message: string, context?: LogContext): Promise<void> {
    return this.write("error", message, context);
  }

  private async write(level: LogLevel, message: string, context?: LogContext): Promise<void> {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.options.config.level]) return;

    const line = formatLogLine(this.now(), level, message, context);
    if (this.options.config.console) this.writeConsole(level, line);
    if (this.options.config.file) {
      await this.ensureDirectory();
      await this.writeTextFile(this.filePath, `${line}\n`, { append: true });
    }
  }

  private writeConsole(level: LogLevel, line: string): void {
    if (level === "error") {
      this.consoleError(line);
      return;
    }
    if (level === "warn") {
      this.consoleWarn(line);
      return;
    }
    this.consoleLog(line);
  }

  private async ensureDirectory(): Promise<void> {
    if (this.directoryReady) return;
    await this.mkdir(this.options.config.dir, { recursive: true });
    this.directoryReady = true;
  }
}

function formatLogLine(
  date: Date,
  level: LogLevel,
  message: string,
  context?: LogContext,
): string {
  const contextText = context && Object.keys(context).length > 0
    ? ` ${JSON.stringify(context)}`
    : "";
  return `[${formatLocalTimestamp(date)}] [${level.toUpperCase()}] ${message}${contextText}`;
}

function localDateParts(date: Date): {
  y: string;
  M: string;
  d: string;
  h: string;
  m: string;
  s: string;
} {
  return {
    y: String(date.getFullYear()),
    M: String(date.getMonth() + 1).padStart(2, "0"),
    d: String(date.getDate()).padStart(2, "0"),
    h: String(date.getHours()).padStart(2, "0"),
    m: String(date.getMinutes()).padStart(2, "0"),
    s: String(date.getSeconds()).padStart(2, "0"),
  };
}

function formatLocalTimestamp(date: Date): string {
  const { y, M, d, h, m, s } = localDateParts(date);
  return `${y}-${M}-${d} ${h}:${m}:${s}`;
}

function timestampFilePart(date: Date): string {
  const { y, M, d, h, m, s } = localDateParts(date);
  return `${y}${M}${d}_${h}${m}${s}`;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
