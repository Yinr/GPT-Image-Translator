import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import type { ExecuteResult } from "./run.ts";

export function formatTranslateLog(message: string): string {
  const color = shouldUseColor();
  const label = (text: string, style = cyan) => color ? bold(style(text)) : text;
  const secondary = (text: string) => color ? dim(text) : text;

  if (message.startsWith("Scanning images in ")) {
    return `${label("SCAN")} ${
      secondary(shortenPathForDisplay(message.slice("Scanning images in ".length)))
    }`;
  }

  if (message.startsWith("Found ")) {
    return `${label("SCAN")} ${
      color
        ? message.replace(/Found (\d+)/, (_match, count: string) => `Found ${cyan(count)}`)
        : message
    }`;
  }

  if (message.startsWith("Starting run ")) {
    return `${label("RUN")} ${highlightKeyValuePairs(message, color)}`;
  }

  if (message.startsWith("Resuming run ")) {
    return `${label("RESUME")} ${highlightKeyValuePairs(message, color)}`;
  }

  if (message.startsWith("Planned jobs: ")) {
    return `${label("PLAN")} ${highlightKeyValuePairs(message, color)}`;
  }

  if (message.startsWith("Preprocess aspectPad enabled ")) {
    return `${label("PREPROCESS")} ${highlightKeyValuePairs(message, color)}`;
  }

  if (message.startsWith("Prepared ")) {
    return `${label("PREP")} ${highlightKeyValuePairs(shortenPathsInMessage(message), color)}`;
  }

  if (message.startsWith("Attempt ")) {
    return `${label("START")} ${highlightProgress(shortenPathsInMessage(message), color)}`;
  }

  if (message.startsWith("Completed [")) {
    return `${label("DONE", green)} ${highlightProgress(shortenPathsInMessage(message), color)}`;
  }

  if (message.startsWith("Will retry [")) {
    return `${label("RETRY", yellow)} ${highlightProgress(shortenPathsInMessage(message), color)}`;
  }

  if (message.startsWith("Cooling down ")) {
    return `${label("COOLDOWN", yellow)} ${highlightProgress(message, color)}`;
  }

  if (message.startsWith("Failed [")) {
    return `${label("FAIL", red)} ${highlightProgress(shortenPathsInMessage(message), color)}`;
  }

  if (message.startsWith("No runnable jobs remain ")) {
    return `${label("RUN")} ${message}`;
  }

  return shortenPathsInMessage(message);
}

export function formatSummary(result: ExecuteResult, dryRun: boolean): string {
  const color = shouldUseColor();
  if (dryRun) {
    return color
      ? `${
        bold(cyan("DRY RUN"))
      } ${result.totalImages} image(s), ${result.plannedJobs} planned job(s).`
      : `Dry run: ${result.totalImages} image(s), ${result.plannedJobs} planned job(s).`;
  }

  const status = result.stopped
    ? result.stopReason === "interrupted"
      ? color ? bold(yellow("STOPPED")) : "STOPPED"
      : color
      ? bold(red("STOPPED"))
      : "STOPPED"
    : (result.failed ?? 0) > 0
    ? color ? bold(red("FINISHED")) : "FINISHED"
    : color
    ? bold(green("FINISHED"))
    : "FINISHED";

  return [
    status,
    `run=${result.runId ?? "n/a"}`,
    `resumed=${result.resumed ? "yes" : "no"}`,
    `processed=${result.processed ?? 0}`,
    `succeeded=${result.succeeded ?? 0}`,
    `retryable=${result.retryable ?? 0}`,
    `failed=${result.failed ?? 0}`,
    `skipped=${result.skipped ?? 0}`,
    `pending=${result.pending ?? 0}`,
    `stopped=${result.stopped ? "yes" : "no"}`,
    result.stopReason ? `stopReason=${result.stopReason}` : undefined,
  ].filter((part): part is string => Boolean(part)).join(" | ");
}

export function formatInterruptMessage(kind: "graceful" | "force"): string {
  const color = shouldUseColor();
  if (kind === "graceful") {
    const label = color ? bold(yellow("INTERRUPT")) : "INTERRUPT";
    return `${label} Stopping after the current job finishes. Press Ctrl+C again to force exit.`;
  }

  const label = color ? bold(red("FORCE EXIT")) : "FORCE EXIT";
  return `${label} The current job may remain running until the next resume resets it.`;
}

export function formatFailedJobs(result: ExecuteResult): string[] {
  if (!result.failedJobs || result.failedJobs.length === 0) return [];

  return [
    "Failed jobs:",
    ...result.failedJobs.map((failedJob) =>
      `- ${shortenPathForDisplay(failedJob.inputPath)} -> ${
        shortenPathForDisplay(failedJob.outputPath)
      } [${failedJob.errorType ?? "unknown"}] ${failedJob.errorMessage ?? ""}`
        .trim()
    ),
  ];
}

function highlightKeyValuePairs(message: string, color: boolean): string {
  if (!color) return message;
  return message.replaceAll(
    /(total|pending|retryable|skipped|succeeded|failed|minDelayMs|concurrency|formatFromApi)=([^, ]+)/g,
    (_match, key: string, value: string) => `${bold(key)}=${cyan(value)}`,
  );
}

function highlightProgress(message: string, color: boolean): string {
  if (!color) return message;
  const withProgress = message.replace(
    /\[(work=\d+\/\d+, left=\d+(?:, retry=\d+)?(?:, failed=\d+)?|work=\d+\/\d+, waiting=\d+, retryable=\d+, failed=\d+, skipped=\d+, total=\d+|done=\d+\/\d+, waiting=\d+, retryable=\d+, failed=\d+, skipped=\d+|\d+\/\d+)\]/,
    (_match, value: string) => `[${cyan(value)}]`,
  );
  const withAttempt = withProgress.replace(
    /attempt (\d+)/,
    (_match, value: string) => `attempt ${cyan(value)}`,
  );
  return withAttempt.replace(/(\d+(?:\.\d+)?s|\d+m \d+s|\d+ms)/g, (value) => cyan(value));
}

function shortenPathsInMessage(message: string): string {
  return message.replace(
    /[A-Za-z]:\\[^\s]+|(?:\.\/|\.\\)[^\s]+/g,
    (path) => shortenPathForDisplay(path),
  );
}

export function shortenPathForDisplay(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const localIndex = normalized.lastIndexOf("/.local/");
  if (localIndex >= 0) return `.${normalized.slice(localIndex)}`;

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 4) return path;
  return `.../${parts.slice(-4).join("/")}`;
}

function shouldUseColor(): boolean {
  if (Deno.noColor) return false;
  if (!Deno.stdout.isTerminal()) return false;
  return true;
}
