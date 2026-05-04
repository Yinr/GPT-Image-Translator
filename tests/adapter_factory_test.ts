import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { createImageAdapter } from "../src/adapters/factory.ts";
import { Gpt2ApiAdapter } from "../src/adapters/gpt2api-adapter.ts";
import { OpenAIAdapter } from "../src/adapters/openai-adapter.ts";
import { Pic2ApiAdapter } from "../src/adapters/pic2api-adapter.ts";
import type { OpenAIConfig } from "../src/shared/types.ts";

const config: OpenAIConfig = {
  baseUrl: "http://example.test/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  proxy: {
    url: "",
  },
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

Deno.test("createImageAdapter injects configured proxy client into fetch", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".png" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));
  const fakeClient = { close: () => {} } as Deno.HttpClient;
  const seen: { proxyUrl?: string; client?: Deno.HttpClient } = {};
  const client = createImageAdapter(
    {
      ...config,
      apiKey: "config-key",
      proxy: { url: "http://user:password@127.0.0.1:7890" },
    },
    () => undefined,
    {
      createHttpClient: (options) => {
        seen.proxyUrl = typeof options.proxy === "object" && "url" in options.proxy
          ? options.proxy.url
          : undefined;
        return fakeClient;
      },
      fetch: async (_input, init) => {
        seen.client = (init as RequestInit & { client?: Deno.HttpClient } | undefined)?.client;
        return new Response(
          JSON.stringify({
            output_format: "png",
            data: [{ b64_json: btoa("abc") }],
          }),
          { status: 200 },
        );
      },
    },
  );

  await client.editImage({ imagePath, prompt: "translate" });
  client.close?.();

  assertEquals(seen.proxyUrl, "http://user:password@127.0.0.1:7890");
  assertEquals(seen.client, fakeClient);
});

Deno.test("createImageAdapter closes configured proxy client", () => {
  let closed = false;
  const client = createImageAdapter(
    {
      ...config,
      apiKey: "config-key",
      proxy: { url: "http://127.0.0.1:7890" },
    },
    () => undefined,
    {
      createHttpClient: () =>
        ({
          close: () => {
            closed = true;
          },
        }) as Deno.HttpClient,
      fetch: () => Promise.resolve(new Response("{}")),
    },
  );

  client.close?.();

  assertEquals(closed, true);
});

Deno.test("createImageAdapter redacts proxy credentials in setup errors", () => {
  assertThrows(
    () =>
      createImageAdapter(
        {
          ...config,
          apiKey: "config-key",
          proxy: { url: "http://user:password@127.0.0.1:7890" },
        },
        () => undefined,
        {
          createHttpClient: () => {
            throw new Error("proxy setup failed");
          },
        },
      ),
    Error,
    "Failed to configure proxy http://***:***@127.0.0.1:7890/",
  );
});
