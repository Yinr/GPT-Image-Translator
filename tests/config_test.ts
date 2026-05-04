import { assertEquals, assertRejects } from "@std/assert";
import { APP_VERSION } from "../src/shared/app-meta.ts";
import { loadConfig } from "../src/config/load.ts";

Deno.test("loadConfig loads example config with defaults", async () => {
  const config = await loadConfig("config.example.yaml");

  assertEquals(config.configVersion, 2);
  assertEquals(config.openai.model, "gpt-image-2");
  assertEquals(config.openai.userAgent, undefined);
  assertEquals(config.queue.concurrency, 1);
  assertEquals(config.scan.extensions.includes(".jpg"), true);
  assertEquals(config.openai.image.size, "auto");
  assertEquals(config.openai.image.outputFormat, "png");
  assertEquals(config.logging.enabled, false);
  assertEquals(config.logging.level, "info");
  assertEquals(config.logging.dir, "./logs");
  assertEquals(config.preprocess.aspectPad.enabled, false);
  assertEquals(config.preprocess.aspectPad.fill, "transparent");
  assertEquals(config.preprocess.aspectPad.cropBackToOriginal, false);
  assertEquals(config.preprocess.aspectPad.intermediateDir, ".intermediate");
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

Deno.test("loadConfig accepts pic2api adapter mode", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  await Deno.writeTextFile(
    path,
    [
      "inputDir: ./input",
      "outputDir: ./output",
      "prompt: translate",
      "openai:",
      "  adapter: pic2api",
      "  baseUrl: https://www.pic2api.com/v1",
      "  apiKey: test-key",
      "  model: gpt-image-2",
    ].join("\n"),
  );

  const config = await loadConfig(path);

  assertEquals(config.openai.adapter, "pic2api");
});

Deno.test("loadConfig normalizes explicit userAgent", async () => {
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
      "  userAgent: '  MyAgent/1.0  '",
      "  model: gpt-image-2",
    ].join("\n"),
  );

  const config = await loadConfig(path);

  assertEquals(config.openai.userAgent, "MyAgent/1.0");
});

Deno.test("loadConfig treats empty userAgent as undefined", async () => {
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
      "  userAgent: ''",
      "  model: gpt-image-2",
    ].join("\n"),
  );

  const config = await loadConfig(path);

  assertEquals(config.openai.userAgent, undefined);
});

Deno.test("loadConfig resolves builtin default userAgent keyword", async () => {
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
      "  userAgent: default",
      "  model: gpt-image-2",
    ].join("\n"),
  );

  const config = await loadConfig(path);

  assertEquals(config.openai.userAgent, `GPT-Image-Translator/${APP_VERSION}`);
});

Deno.test("loadConfig resolves builtin cherry-studio userAgent keyword", async () => {
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
      "  userAgent: cherry-studio",
      "  model: gpt-image-2",
    ].join("\n"),
  );

  const config = await loadConfig(path);

  assertEquals(
    config.openai.userAgent,
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CherryStudio/1.9.4 Chrome/146.0.7680.188 Electron/41.2.1 Safari/537.36",
  );
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

Deno.test("loadConfig normalizes and validates logging config", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  await Deno.writeTextFile(
    path,
    [
      "inputDir: ./input",
      "outputDir: ./output",
      "prompt: translate",
      "logging:",
      "  enabled: true",
      "  level: DEBUG",
      "  dir: ./custom-logs",
    ].join("\n"),
  );

  const config = await loadConfig(path);

  assertEquals(config.logging.enabled, true);
  assertEquals(config.logging.level, "debug");
  assertEquals(config.logging.dir, "./custom-logs");
});

Deno.test("loadConfig rejects invalid logging level", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  await Deno.writeTextFile(
    path,
    [
      "inputDir: ./input",
      "outputDir: ./output",
      "prompt: translate",
      "logging:",
      "  level: verbose",
    ].join("\n"),
  );

  await assertRejects(() => loadConfig(path), Error, "logging.level is invalid");
});

Deno.test("loadConfig normalizes and validates aspectPad config", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  await Deno.writeTextFile(
    path,
    [
      "inputDir: ./input",
      "outputDir: ./output",
      "prompt: translate",
      "preprocess:",
      "  aspectPad:",
      "    enabled: true",
      "    fill: WHITE",
      "    cropBackToOriginal: true",
      "    intermediateDir: '  crops  '",
    ].join("\n"),
  );

  const config = await loadConfig(path);

  assertEquals(config.preprocess.aspectPad.enabled, true);
  assertEquals(config.preprocess.aspectPad.fill, "white");
  assertEquals(config.preprocess.aspectPad.cropBackToOriginal, true);
  assertEquals(config.preprocess.aspectPad.intermediateDir, "crops");
});

Deno.test("loadConfig rejects invalid aspectPad fill", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  await Deno.writeTextFile(
    path,
    [
      "inputDir: ./input",
      "outputDir: ./output",
      "prompt: translate",
      "preprocess:",
      "  aspectPad:",
      "    fill: black",
    ].join("\n"),
  );

  await assertRejects(() => loadConfig(path), Error, "preprocess.aspectPad.fill is invalid");
});

Deno.test("loadConfig rejects unsafe aspectPad intermediateDir", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });
  await Deno.writeTextFile(
    path,
    [
      "inputDir: ./input",
      "outputDir: ./output",
      "prompt: translate",
      "preprocess:",
      "  aspectPad:",
      "    intermediateDir: ../outside",
    ].join("\n"),
  );

  await assertRejects(
    () => loadConfig(path),
    Error,
    "preprocess.aspectPad.intermediateDir must be a safe relative path inside outputDir",
  );
});
