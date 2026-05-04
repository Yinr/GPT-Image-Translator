import type { AppConfig } from "../shared/types.ts";
import { isValidProxyUrl } from "./proxy.ts";
import {
  OPENAI_IMAGE_BACKGROUNDS,
  OPENAI_IMAGE_OUTPUT_FORMATS,
  OPENAI_IMAGE_QUALITIES,
  OPENAI_IMAGE_SIZES,
} from "../openai/image-options.ts";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const ASPECT_PAD_FILLS = ["transparent", "white"] as const;
const OPENAI_ADAPTERS = ["openai", "gpt2api", "pic2api"] as const;

export function validateConfig(config: AppConfig): AppConfig {
  const errors: string[] = [];

  if (!Number.isInteger(config.configVersion) || config.configVersion < 0) {
    errors.push("configVersion must be a non-negative integer");
  }
  if (!config.inputDir.trim()) errors.push("inputDir is required");
  if (!config.outputDir.trim()) errors.push("outputDir is required");
  if (!config.prompt.trim()) errors.push("prompt is required");
  if (!config.openai.baseUrl.trim()) errors.push("openai.baseUrl is required");
  if (!config.openai.apiKey?.trim() && !config.openai.apiKeyEnv?.trim()) {
    errors.push("one of openai.apiKey or openai.apiKeyEnv is required");
  }
  if (!config.openai.model.trim()) errors.push("openai.model is required");
  if (!OPENAI_ADAPTERS.includes(config.openai.adapter as OpenAIAdapterKind)) {
    errors.push("openai.adapter is invalid");
  }
  if (!isValidProxyUrl(config.openai.proxy.url)) {
    errors.push("openai.proxy.url must be empty, none, or a valid http/https/socks5 URL");
  }
  if (config.openai.timeoutMs <= 0) errors.push("openai.timeoutMs must be greater than 0");
  if (!config.openai.image) errors.push("openai.image is required");
  if (config.scan.extensions.length === 0) errors.push("scan.extensions must not be empty");
  if (config.queue.concurrency < 1) errors.push("queue.concurrency must be at least 1");
  if (config.queue.minDelayMs < 0) errors.push("queue.minDelayMs must be at least 0");
  if (config.retry.maxAttempts < 1) errors.push("retry.maxAttempts must be at least 1");
  if (config.retry.initialDelayMs < 0) errors.push("retry.initialDelayMs must be at least 0");
  if (config.retry.maxDelayMs < config.retry.initialDelayMs) {
    errors.push("retry.maxDelayMs must be greater than or equal to retry.initialDelayMs");
  }
  if (config.retry.backoffFactor < 1) errors.push("retry.backoffFactor must be at least 1");
  if (!config.storage.sqlitePath.trim()) errors.push("storage.sqlitePath is required");
  if (!config.preprocess?.aspectPad) errors.push("preprocess.aspectPad is required");
  if (config.preprocess?.aspectPad) {
    if (!ASPECT_PAD_FILLS.includes(config.preprocess.aspectPad.fill as AspectPadFill)) {
      errors.push("preprocess.aspectPad.fill is invalid");
    }
    if (!config.preprocess.aspectPad.intermediateDir.trim()) {
      errors.push("preprocess.aspectPad.intermediateDir is required");
    }
    if (isUnsafeIntermediateDir(config.preprocess.aspectPad.intermediateDir)) {
      errors.push(
        "preprocess.aspectPad.intermediateDir must be a safe relative path inside outputDir",
      );
    }
  }
  if (!config.logging.dir.trim()) errors.push("logging.dir is required");
  if (!LOG_LEVELS.includes(config.logging.level as (typeof LOG_LEVELS)[number])) {
    errors.push("logging.level is invalid");
  }
  if (config.logging.enabled && !config.logging.console && !config.logging.file) {
    errors.push("logging.console and logging.file cannot both be false when logging is enabled");
  }

  if (config.openai.image) {
    if (!isValidImageSize(config.openai.image.size)) errors.push("openai.image.size is invalid");
    if (!isValidImageQuality(config.openai.image.quality)) {
      errors.push("openai.image.quality is invalid");
    }
    if (!isValidImageBackground(config.openai.image.background)) {
      errors.push("openai.image.background is invalid");
    }
    if (!isValidImageOutputFormat(config.openai.image.outputFormat)) {
      errors.push("openai.image.outputFormat is invalid");
    }
  }

  if (config.output.skipExisting && config.output.overwrite) {
    errors.push("output.skipExisting and output.overwrite cannot both be true");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid config:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  return config;
}

type AspectPadFill = (typeof ASPECT_PAD_FILLS)[number];
type OpenAIAdapterKind = (typeof OPENAI_ADAPTERS)[number];

function isUnsafeIntermediateDir(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return true;
  return normalized.split("/").some((part) => part === ".." || part === "");
}

function isValidImageSize(value: string): boolean {
  return OPENAI_IMAGE_SIZES.includes(value as (typeof OPENAI_IMAGE_SIZES)[number]);
}

function isValidImageQuality(value: string): boolean {
  return OPENAI_IMAGE_QUALITIES.includes(value as (typeof OPENAI_IMAGE_QUALITIES)[number]);
}

function isValidImageBackground(value: string): boolean {
  return OPENAI_IMAGE_BACKGROUNDS.includes(value as (typeof OPENAI_IMAGE_BACKGROUNDS)[number]);
}

function isValidImageOutputFormat(value: string): boolean {
  return OPENAI_IMAGE_OUTPUT_FORMATS.includes(
    value as (typeof OPENAI_IMAGE_OUTPUT_FORMATS)[number],
  );
}
