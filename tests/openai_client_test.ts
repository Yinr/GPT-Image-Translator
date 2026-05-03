import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { Image } from "@matmen/imagescript";
import { join } from "@std/path";
import { normalizeBaseUrl } from "../src/adapters/base/openai-compatible-adapter.ts";
import { OpenAIAdapter } from "../src/adapters/openai-adapter.ts";
import { ApiError } from "../src/openai/error-classifier.ts";
import { Gpt2ApiAdapter } from "../src/adapters/gpt2api-adapter.ts";
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

Deno.test("normalizeBaseUrl appends v1 when missing", () => {
  assertEquals(normalizeBaseUrl("http://example.test"), "http://example.test/v1");
  assertEquals(normalizeBaseUrl("http://example.test/v1/"), "http://example.test/v1");
});

Deno.test("OpenAIAdapter sends image edit request and parses response", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".jpg" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));

  const seen: {
    url?: string;
    authorization?: string;
    bodyIsFormData?: boolean;
    fields?: string[];
  } = {};
  const client = new OpenAIAdapter(config, "test-key", async (input, init) => {
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

Deno.test("OpenAIAdapter downloads image when provider returns data[0].url", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".jpg" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));

  const seenUrls: string[] = [];
  const client = new OpenAIAdapter(config, "test-key", async (input, init) => {
    seenUrls.push(String(input));
    if (String(input).endsWith("/images/edits")) {
      return new Response(
        JSON.stringify({
          data: [{ url: "http://cdn.example.test/generated.webp", width: 10, height: 20 }],
        }),
        { status: 200 },
      );
    }

    assertEquals((init as RequestInit | undefined)?.method, "GET");
    return new Response(new Uint8Array([7, 8, 9]), {
      status: 200,
      headers: { "content-type": "image/webp" },
    });
  });

  const result = await client.editImage({ imagePath, prompt: "translate" });

  assertEquals(seenUrls, [
    "http://example.test/v1/images/edits",
    "http://cdn.example.test/generated.webp",
  ]);
  assertEquals([...result.bytes], [7, 8, 9]);
  assertEquals(result.outputFormat, "webp");
  assertEquals(result.width, 10);
  assertEquals(result.height, 20);
});

Deno.test("OpenAIAdapter resolves relative image URLs against response URL", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".jpg" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));

  const seenUrls: string[] = [];
  const client = new OpenAIAdapter(config, "test-key", async (input) => {
    seenUrls.push(String(input));
    if (String(input).endsWith("/images/edits")) {
      return new Response(
        JSON.stringify({
          data: [{ url: "/storage/generated/abc123.png" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(new Uint8Array([7, 8, 9]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  });

  const result = await client.editImage({ imagePath, prompt: "translate" });

  assertEquals(seenUrls, [
    "http://example.test/v1/images/edits",
    "http://example.test/storage/generated/abc123.png",
  ]);
  assertEquals([...result.bytes], [7, 8, 9]);
  assertEquals(result.outputFormat, "png");
});

Deno.test("OpenAIAdapter saves raw response when successful response is malformed", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".jpg" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));
  const artifactDir = await Deno.makeTempDir();
  const artifactPath = join(artifactDir, "out.png.api-response.json");

  const client = new OpenAIAdapter(config, "test-key", async () => {
    return new Response(JSON.stringify({ data: [{ foo: "bar" }] }), { status: 200 });
  });

  try {
    await client.editImage({ imagePath, prompt: "translate", responseArtifactPath: artifactPath });
    throw new Error("Expected malformed response to fail");
  } catch (error) {
    assertInstanceOf(error, ApiError);
    assertEquals(error.info.kind, "invalid_response");
    assertEquals(error.info.message.includes(artifactPath), true);
  }

  const saved = JSON.parse(await Deno.readTextFile(artifactPath));
  assertEquals(saved.status, 200);
  assertEquals(saved.responseText, JSON.stringify({ data: [{ foo: "bar" }] }));
});

Deno.test("Gpt2ApiAdapter falls back to reference generations JSON request", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".png" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));

  const seen: Array<{ url: string; method?: string; contentType?: string; body?: string }> = [];
  const client = new Gpt2ApiAdapter(
    { ...config, adapter: "gpt2api" },
    "test-key",
    async (input, init) => {
      const requestInit = init as RequestInit | undefined;
      const bodyText = typeof requestInit?.body === "string" ? requestInit.body : undefined;
      seen.push({
        url: String(input),
        method: requestInit?.method,
        contentType: requestInit?.headers instanceof Headers
          ? requestInit.headers.get("Content-Type") ?? undefined
          : (requestInit?.headers as Record<string, string> | undefined)?.["Content-Type"],
        body: bodyText,
      });

      if (String(input).endsWith("/images/edits")) {
        return new Response(
          JSON.stringify({ error: { message: "use application/json reference_images" } }),
          {
            status: 400,
          },
        );
      }
      if (String(input).endsWith("/images/generations")) {
        return new Response(
          JSON.stringify({ data: [{ url: "http://cdn.example.test/generated.png" }] }),
          {
            status: 200,
          },
        );
      }

      return new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    },
  );

  const result = await client.editImage({ imagePath, prompt: "translate", size: "1024x1536" });

  assertEquals(seen[0].url, "http://example.test/v1/images/edits");
  assertEquals(seen[1].url, "http://example.test/v1/images/generations");
  assertEquals(seen[1].contentType, "application/json");
  assertEquals(seen[1].body?.includes("reference_images"), true);
  assertEquals(seen[1].body?.includes("1024x1536"), true);
  assertEquals(seen[2].url, "http://cdn.example.test/generated.png");
  assertEquals([...result.bytes], [4, 5, 6]);
  assertEquals(result.outputFormat, "png");
});

Deno.test("OpenAIAdapter does not use reference generations fallback", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".png" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));

  const seenUrls: string[] = [];
  const client = new OpenAIAdapter(config, "test-key", async (input) => {
    seenUrls.push(String(input));
    return new Response(
      JSON.stringify({ error: { message: "use application/json reference_images" } }),
      {
        status: 400,
      },
    );
  });

  try {
    await client.editImage({ imagePath, prompt: "translate" });
    throw new Error("Expected request to fail without fallback");
  } catch (error) {
    assertInstanceOf(error, ApiError);
    assertEquals(error.info.kind, "bad_request");
  }

  assertEquals(seenUrls, ["http://example.test/v1/images/edits"]);
});

Deno.test("OpenAIAdapter throws classified API errors", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".jpg" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));

  const client = new OpenAIAdapter(config, "test-key", () => {
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

Deno.test("OpenAIAdapter allows request size override", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".jpg" });
  await Deno.writeFile(imagePath, new Uint8Array([1, 2, 3]));

  let size: FormDataEntryValue | null = null;
  const client = new OpenAIAdapter(config, "test-key", async (_input, init) => {
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

Deno.test("Pic2ApiAdapter selects recommended size for gpt-image-2 auto mode", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".png" });
  await Deno.writeFile(imagePath, await createPngPlaceholder(1600, 900));

  let size: FormDataEntryValue | null = null;
  let quality: FormDataEntryValue | null = null;
  const client = new Pic2ApiAdapter(
    {
      ...config,
      adapter: "pic2api",
      image: { ...config.image, size: "auto", quality: "medium" },
    },
    "test-key",
    async (_input, init) => {
      const body = (init as globalThis.RequestInit | undefined)?.body;
      if (body instanceof FormData) {
        size = body.get("size");
        quality = body.get("quality");
      }

      return new Response(
        JSON.stringify({
          output_format: "png",
          data: [{ b64_json: btoa("abc") }],
        }),
        { status: 200 },
      );
    },
  );

  await client.editImage({ imagePath, prompt: "translate" });

  assertEquals(size, "2560x1440");
  assertEquals(quality, "hd");
});

Deno.test("Pic2ApiAdapter keeps explicit request size", async () => {
  const imagePath = await Deno.makeTempFile({ suffix: ".png" });
  await Deno.writeFile(imagePath, await createPngPlaceholder(1600, 900));

  let size: FormDataEntryValue | null = null;
  const client = new Pic2ApiAdapter(
    { ...config, adapter: "pic2api", image: { ...config.image, size: "auto", quality: "high" } },
    "test-key",
    async (_input, init) => {
      const body = (init as globalThis.RequestInit | undefined)?.body;
      if (body instanceof FormData) size = body.get("size");

      return new Response(
        JSON.stringify({
          output_format: "png",
          data: [{ b64_json: btoa("abc") }],
        }),
        { status: 200 },
      );
    },
  );

  await client.editImage({ imagePath, prompt: "translate", size: "1024x1536" });

  assertEquals(size, "1024x1536");
});

async function createPngPlaceholder(width: number, height: number): Promise<Uint8Array> {
  const image = new Image(width, height);
  image.fill(0xffffffff);
  return await image.encode();
}
