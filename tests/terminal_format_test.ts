import { assertEquals } from "@std/assert";
import {
  formatFailedJobs,
  formatInterruptMessage,
  formatSummary,
  formatTranslateLog,
  shortenPathForDisplay,
} from "../src/cli/terminal-format.ts";

Deno.test("formatTranslateLog labels preprocessing messages", () => {
  assertEquals(
    formatTranslateLog("Preprocess aspectPad enabled fill=transparent cropBack=false"),
    "PREPROCESS Preprocess aspectPad enabled fill=transparent cropBack=false",
  );
  assertEquals(
    formatTranslateLog(
      "Prepared D:\\Project\\GPT-Image-Translator\\.local\\comic\\a.png -> 1024x1536 padded=800x1200 cropBack=no",
    ),
    "PREP Prepared ./.local/comic/a.png -> 1024x1536 padded=800x1200 cropBack=no",
  );
});

Deno.test("formatSummary returns concise translate summary", () => {
  assertEquals(
    formatSummary({
      runId: "run-1",
      resumed: false,
      totalImages: 2,
      plannedJobs: 2,
      processed: 1,
      succeeded: 1,
      retryable: 0,
      failed: 0,
      skipped: 0,
      pending: 1,
      stopped: true,
      stopReason: "interrupted",
    }, false),
    "STOPPED | run=run-1 | resumed=no | processed=1 | succeeded=1 | retryable=0 | failed=0 | skipped=0 | pending=1 | stopped=yes | stopReason=interrupted",
  );
});

Deno.test("formatInterruptMessage returns clear interruption messages", () => {
  assertEquals(
    formatInterruptMessage("graceful"),
    "INTERRUPT Stopping after the current job finishes. Press Ctrl+C again to force exit.",
  );
  assertEquals(
    formatInterruptMessage("force"),
    "FORCE EXIT The current job may remain running until the next resume resets it.",
  );
});

Deno.test("formatFailedJobs returns failed job lines", () => {
  assertEquals(
    formatFailedJobs({
      totalImages: 1,
      plannedJobs: 1,
      failedJobs: [{
        inputPath: "input/a.jpg",
        outputPath: "output/a.png",
        errorType: "rate_limit",
        errorMessage: "slow down",
      }],
    }),
    ["Failed jobs:", "- input/a.jpg -> output/a.png [rate_limit] slow down"],
  );
});

Deno.test("shortenPathForDisplay prefers local relative path", () => {
  assertEquals(
    shortenPathForDisplay("D:\\Project\\GPT-Image-Translator\\.local\\comic\\17-22\\034.jpg"),
    "./.local/comic/17-22/034.jpg",
  );
});

Deno.test("shortenPathForDisplay keeps last path segments for long non-local paths", () => {
  assertEquals(
    shortenPathForDisplay("D:\\Project\\GPT-Image-Translator\\output\\17-22\\034.png"),
    ".../GPT-Image-Translator/output/17-22/034.png",
  );
});
