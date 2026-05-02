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
