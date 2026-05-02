import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  createOpenAIImageClient,
  normalizeBaseUrl,
  OpenAIImageClient,
} from "../src/openai/client.ts";
import { ApiError } from "../src/openai/error-classifier.ts";
import type { OpenAIConfig } from "../src/shared/types.ts";

const config: OpenAIConfig = {
  baseUrl: "http://example.test/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  model: "gpt-image-2",
  timeoutMs: 1000,
  image: {
    size: "auto",
    quality: "auto",
    background: "auto",
    outputFormat: "png",
  },
};

Deno.test("normalizeBaseUrl appends v1 when missing", () => {
  assertEquals(normalizeBaseUrl("http://example.test"), "http://example.test/v1");
  assertEquals(normalizeBaseUrl("http://example.test/v1/"), "http://example.test/v1");
});

Deno.test("OpenAIImageClient sends image edit request and parses response", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".jpg" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));

  const seen: {
    url?: string;
    authorization?: string;
    bodyIsFormData?: boolean;
    fields?: string[];
  } = {};
  const client = new OpenAIImageClient(config, "test-key", async (input, init) => {
    const requestInit = init as globalThis.RequestInit | undefined;
    seen.url = String(input);
    seen.authorization = (requestInit?.headers as Record<string, string>)?.Authorization;
    seen.bodyIsFormData = requestInit?.body instanceof FormData;
    if (requestInit?.body instanceof FormData) {
      seen.fields = Array.from(requestInit.body.keys());
    }

    return new Response(
      JSON.stringify({
        output_format: "png",
        data: [{ b64_json: btoa("abc"), bytes: 3, width: 1, height: 1 }],
      }),
      { status: 200 },
    );
  });

  const result = await client.editImage({ imagePath, prompt: "translate" });

  assertEquals(seen.url, "http://example.test/v1/images/edits");
  assertEquals(seen.authorization, "Bearer test-key");
  assertEquals(seen.bodyIsFormData, true);
  assertEquals(seen.fields?.includes("size"), false);
  assertEquals(seen.fields?.includes("quality"), false);
  assertEquals(seen.fields?.includes("background"), false);
  assertEquals(seen.fields?.includes("output_format"), true);
  assertEquals([...result.bytes], [97, 98, 99]);
  assertEquals(result.outputFormat, "png");
});

Deno.test("OpenAIImageClient throws classified API errors", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".jpg" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));

  const client = new OpenAIImageClient(config, "test-key", () => {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          error: { message: "bad key" },
        }),
        { status: 401 },
      ),
    );
  });

  try {
    await client.editImage({ imagePath, prompt: "translate" });
    throw new Error("Expected request to fail");
  } catch (error) {
    assertInstanceOf(error, ApiError);
    assertEquals(error.info.kind, "authentication_error");
    assertEquals(error.info.stopRun, true);
  }
});

Deno.test("OpenAIImageClient allows request size override", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".jpg" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));

  let size: FormDataEntryValue | null = null;
  const client = new OpenAIImageClient(config, "test-key", async (_input, init) => {
    const body = (init as globalThis.RequestInit | undefined)?.body;
    if (body instanceof FormData) size = body.get("size");

    return new Response(
      JSON.stringify({
        output_format: "png",
        data: [{ b64_json: btoa("abc") }],
      }),
      { status: 200 },
    );
  });

  await client.editImage({ imagePath, prompt: "translate", size: "1024x1536" });

  assertEquals(size, "1024x1536");
});

Deno.test("createOpenAIImageClient prefers apiKey from config", () => {
  const client = createOpenAIImageClient({
    ...config,
    apiKey: "config-key",
  }, () => "env-key");

  assertInstanceOf(client, OpenAIImageClient);
});

Deno.test("createOpenAIImageClient falls back to apiKeyEnv", () => {
  const client = createOpenAIImageClient(config, () => "env-key");

  assertInstanceOf(client, OpenAIImageClient);
});

Deno.test("createOpenAIImageClient rejects when no api key source is available", () => {
  assertThrows(
    () =>
      createOpenAIImageClient(
        { ...config, apiKey: undefined, apiKeyEnv: undefined },
        () => undefined,
      ),
    Error,
    "Missing API key: set openai.apiKey or openai.apiKeyEnv",
  );
});
