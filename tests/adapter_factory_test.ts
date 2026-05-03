import { assertInstanceOf, assertThrows } from "@std/assert";
import { createImageAdapter } from "../src/adapters/factory.ts";
import { Gpt2ApiAdapter } from "../src/adapters/gpt2api-adapter.ts";
import { OpenAIAdapter } from "../src/adapters/openai-adapter.ts";
import { Pic2ApiAdapter } from "../src/adapters/pic2api-adapter.ts";
import type { OpenAIConfig } from "../src/shared/types.ts";

const config: OpenAIConfig = {
  baseUrl: "http://example.test/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  adapter: "openai",
  model: "gpt-image-2",
  timeoutMs: 1000,
  image: {
    size: "auto",
    quality: "auto",
    background: "auto",
    outputFormat: "png",
  },
};

Deno.test("createImageAdapter returns OpenAIAdapter by default", () => {
  const client = createImageAdapter({ ...config, apiKey: "config-key" }, () => "env-key");
  assertInstanceOf(client, OpenAIAdapter);
});

Deno.test("createImageAdapter returns Gpt2ApiAdapter for gpt2api mode", () => {
  const client = createImageAdapter({ ...config, adapter: "gpt2api", apiKey: "config-key" });
  assertInstanceOf(client, Gpt2ApiAdapter);
});

Deno.test("createImageAdapter returns Pic2ApiAdapter for pic2api mode", () => {
  const client = createImageAdapter({ ...config, adapter: "pic2api", apiKey: "config-key" });
  assertInstanceOf(client, Pic2ApiAdapter);
});

Deno.test("createImageAdapter rejects when no api key source is available", () => {
  assertThrows(
    () =>
      createImageAdapter({ ...config, apiKey: undefined, apiKeyEnv: undefined }, () => undefined),
    Error,
    "Missing API key: set openai.apiKey or openai.apiKeyEnv",
  );
});
