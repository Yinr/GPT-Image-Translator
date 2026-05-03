import { parse } from "@std/yaml";
import { defaultConfig } from "./defaults.ts";
import { validateConfig } from "./schema.ts";
import type { AppConfig } from "../shared/types.ts";

type PlainObject = Record<string, unknown>;

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const text = await Deno.readTextFile(configPath);
  const parsed = parse(text) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error("Config file must contain a YAML object");
  }

  const merged = mergeConfig(defaultConfig, parsed);
  if (!Object.hasOwn(parsed, "configVersion")) merged.configVersion = 0;
  normalizeConfig(merged);
  return validateConfig(merged);
}

function mergeConfig(base: AppConfig, override: PlainObject): AppConfig {
  return deepMerge(structuredClone(base), override) as AppConfig;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = base[key];
    base[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }

  return base;
}

function normalizeConfig(config: AppConfig): void {
  config.scan.extensions = config.scan.extensions.map((extension) => {
    const lower = extension.toLowerCase();
    return lower.startsWith(".") ? lower : `.${lower}`;
  });

  config.openai.baseUrl = config.openai.baseUrl.replace(/\/+$/, "");
  config.openai.apiKey = config.openai.apiKey?.trim() || undefined;
  config.openai.apiKeyEnv = config.openai.apiKeyEnv?.trim() || undefined;
  config.openai.image.size = config.openai.image.size
    .toLowerCase() as AppConfig["openai"]["image"]["size"];
  config.openai.image.quality = config.openai.image.quality
    .toLowerCase() as AppConfig["openai"]["image"]["quality"];
  config.openai.image.background = config.openai.image.background
    .toLowerCase() as AppConfig["openai"]["image"]["background"];
  config.openai.image.outputFormat = config.openai.image.outputFormat
    .toLowerCase() as AppConfig["openai"]["image"]["outputFormat"];
  config.preprocess.aspectPad.fill = config.preprocess.aspectPad.fill
    .toLowerCase() as AppConfig["preprocess"]["aspectPad"]["fill"];
  config.preprocess.aspectPad.intermediateDir = config.preprocess.aspectPad.intermediateDir.trim();
  config.logging.level = config.logging.level.toLowerCase() as AppConfig["logging"]["level"];
  config.logging.dir = config.logging.dir.trim();
}

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
