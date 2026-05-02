import type { AppConfig } from "../shared/types.ts";

export const defaultConfig: AppConfig = {
  inputDir: "./input",
  outputDir: "./output",
  prompt: "",
  openai: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    model: "gpt-image-2",
    timeoutMs: 600_000,
    image: {
      size: "auto",
      quality: "auto",
      background: "auto",
      outputFormat: "png",
    },
  },
  scan: {
    recursive: true,
    extensions: [".jpg", ".jpeg", ".png", ".webp"],
  },
  output: {
    skipExisting: true,
    overwrite: false,
    formatFromApi: true,
  },
  queue: {
    resume: true,
    concurrency: 1,
    minDelayMs: 1_000,
    failFast: false,
  },
  retry: {
    maxAttempts: 5,
    initialDelayMs: 3_000,
    maxDelayMs: 300_000,
    backoffFactor: 2,
  },
  storage: {
    sqlitePath: "./state/translator.db",
  },
  logging: {
    enabled: false,
    level: "info",
    dir: "./logs",
    console: false,
    file: true,
  },
};
