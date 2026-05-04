import type { OpenAIConfig } from "../shared/types.ts";
import { redactProxyUrl } from "../config/proxy.ts";
import type { ImageAdapter } from "./image-adapter.ts";
import { Gpt2ApiAdapter } from "./gpt2api-adapter.ts";
import { OpenAIAdapter } from "./openai-adapter.ts";
import { Pic2ApiAdapter } from "./pic2api-adapter.ts";
import type { FetchLike } from "./base/openai-compatible-adapter.ts";

type CreateHttpClient = typeof Deno.createHttpClient;
type DenoRequestInit = RequestInit & { client?: Deno.HttpClient };

interface CreateImageAdapterDeps {
  fetchImpl?: FetchLike;
  createHttpClient?: CreateHttpClient;
}

export function createImageAdapter(
  config: OpenAIConfig,
  getEnv: (name: string) => string | undefined = Deno.env.get,
  deps: CreateImageAdapterDeps = {},
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

  const fetchImpl = createProxyFetch(config, deps.fetchImpl ?? fetch, deps.createHttpClient);

  if (config.adapter === "gpt2api") return new Gpt2ApiAdapter(config, apiKey, fetchImpl);
  if (config.adapter === "pic2api") return new Pic2ApiAdapter(config, apiKey, fetchImpl);
  return new OpenAIAdapter(config, apiKey, fetchImpl);
}

function createProxyFetch(
  config: OpenAIConfig,
  fetchImpl: FetchLike,
  createHttpClient: CreateHttpClient = Deno.createHttpClient,
): FetchLike {
  const proxyUrl = config.proxy.url.trim();
  if (!proxyUrl) return fetchImpl;

  let client: Deno.HttpClient;
  try {
    client = createHttpClient({ proxy: { url: proxyUrl } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to configure proxy ${redactProxyUrl(proxyUrl)}: ${message}`);
  }
  return ((input, init) => fetchImpl(input, { ...init, client } as DenoRequestInit)) as FetchLike;
}
