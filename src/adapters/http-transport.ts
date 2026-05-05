import type { OpenAIConfig } from "../shared/types.ts";
import { redactProxyUrl } from "../config/proxy.ts";

export type FetchLike = typeof fetch;

type CreateHttpClient = typeof Deno.createHttpClient;
type FetchInit = Parameters<typeof fetch>[1];

export interface HttpTransport {
  fetch: FetchLike;
  close(): void;
}

export interface CreateHttpTransportDeps {
  fetch?: FetchLike;
  createHttpClient?: CreateHttpClient;
}

export function createHttpTransport(
  config: OpenAIConfig,
  deps: CreateHttpTransportDeps = {},
): HttpTransport {
  const fetchImpl = deps.fetch ?? fetch;
  const proxyUrl = config.proxy.url.trim();
  if (!proxyUrl) return { fetch: fetchImpl, close: () => {} };

  let client: Deno.HttpClient;
  try {
    client = (deps.createHttpClient ?? Deno.createHttpClient)({ proxy: { url: proxyUrl } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to configure proxy ${redactProxyUrl(proxyUrl)}: ${message}`);
  }

  return {
    fetch:
      ((input, init) => fetchImpl(input, { ...init, client } satisfies FetchInit)) as FetchLike,
    close: () => client.close(),
  };
}
