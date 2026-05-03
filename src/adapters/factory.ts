import type { OpenAIConfig } from "../shared/types.ts";
import type { ImageAdapter } from "./image-adapter.ts";
import { Gpt2ApiAdapter } from "./gpt2api-adapter.ts";
import { OpenAIAdapter } from "./openai-adapter.ts";
import { Pic2ApiAdapter } from "./pic2api-adapter.ts";

export function createImageAdapter(
  config: OpenAIConfig,
  getEnv: (name: string) => string | undefined = Deno.env.get,
): ImageAdapter {
  const apiKey = config.apiKey?.trim() ||
    (config.apiKeyEnv ? getEnv(config.apiKeyEnv)?.trim() : undefined);
  if (!apiKey) {
    if (config.apiKeyEnv) {
      throw new Error(
        `Missing API key: openai.apiKey is empty and environment variable ${config.apiKeyEnv} is not set`,
      );
    }

    throw new Error("Missing API key: set openai.apiKey or openai.apiKeyEnv");
  }

  if (config.adapter === "gpt2api") return new Gpt2ApiAdapter(config, apiKey);
  if (config.adapter === "pic2api") return new Pic2ApiAdapter(config, apiKey);
  return new OpenAIAdapter(config, apiKey);
}
