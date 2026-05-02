import { assertEquals, assertRejects } from "@std/assert";
import { loadConfig } from "../src/config/load.ts";

Deno.test("loadConfig loads example config with defaults", async () => {
  const config = await loadConfig("config.example.yaml");

  assertEquals(config.openai.model, "gpt-image-2");
  assertEquals(config.queue.concurrency, 1);
  assertEquals(config.scan.extensions.includes(".jpg"), true);
  assertEquals(config.openai.image.size, "auto");
  assertEquals(config.openai.image.outputFormat, "png");
});

Deno.test("loadConfig rejects missing prompt", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  await Deno.writeTextFile(path, "inputDir: ./input\noutputDir: ./output\nprompt: ''\n");

  await assertRejects(() => loadConfig(path), Error, "prompt is required");
});

Deno.test("loadConfig rejects invalid image option", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  await Deno.writeTextFile(
    path,
    [
      "inputDir: ./input",
      "outputDir: ./output",
      "prompt: translate",
      "openai:",
      "  image:",
      "    size: invalid",
    ].join("\n"),
  );

  await assertRejects(() => loadConfig(path), Error, "openai.image.size is invalid");
});

Deno.test("loadConfig accepts direct openai apiKey without apiKeyEnv", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  await Deno.writeTextFile(
    path,
    [
      "inputDir: ./input",
      "outputDir: ./output",
      "prompt: translate",
      "openai:",
      "  baseUrl: https://api.openai.com/v1",
      "  apiKey: test-key",
      "  model: gpt-image-2",
    ].join("\n"),
  );

  const config = await loadConfig(path);

  assertEquals(config.openai.apiKey, "test-key");
  assertEquals(config.openai.apiKeyEnv, "OPENAI_API_KEY");
});

Deno.test("loadConfig rejects missing openai apiKey and apiKeyEnv", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  await Deno.writeTextFile(
    path,
    [
      "inputDir: ./input",
      "outputDir: ./output",
      "prompt: translate",
      "openai:",
      "  baseUrl: https://api.openai.com/v1",
      "  apiKeyEnv: ''",
      "  model: gpt-image-2",
    ].join("\n"),
  );

  await assertRejects(
    () => loadConfig(path),
    Error,
    "one of openai.apiKey or openai.apiKeyEnv is required",
  );
});
