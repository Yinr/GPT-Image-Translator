import { assertEquals, assertThrows } from "@std/assert";
import { upgradeConfigFile, upgradeConfigText } from "../src/config/upgrade.ts";

Deno.test("upgradeConfigText treats missing configVersion as version 0", () => {
  const text = [
    "# my config",
    "inputDir: ./input",
    "outputDir: ./output",
    "prompt: translate",
    "",
  ].join("\n");

  const result = upgradeConfigText(text);

  assertEquals(result.changed, true);
  assertEquals(result.fromVersion, 0);
  assertEquals(result.toVersion, 2);
  assertEquals(result.appendedKeys, ["configVersion", "logging", "preprocess"]);
  assertEquals(
    result.text.startsWith("# 配置文件版本。用于未来安全补全旧配置文件\nconfigVersion: 2"),
    true,
  );
  assertEquals(result.text.includes("# my config"), true);
  assertEquals(result.text.includes("configVersion: 2"), true);
  assertEquals(result.text.includes("logging:"), true);
  assertEquals(result.text.includes("preprocess:"), true);
});

Deno.test("upgradeConfigText updates explicit configVersion 0 to current version", () => {
  const text = [
    "configVersion: 0",
    "inputDir: ./input",
    "outputDir: ./output",
    "prompt: translate",
  ].join("\n");

  const result = upgradeConfigText(text);

  assertEquals(result.fromVersion, 0);
  assertEquals(result.toVersion, 2);
  assertEquals(result.text.includes("configVersion: 2"), true);
  assertEquals(result.text.includes("configVersion: 0"), false);
  assertEquals(result.text.includes("logging:"), true);
  assertEquals(result.text.includes("preprocess:"), true);
});

Deno.test("upgradeConfigText upgrades version 1 config with preprocess block", () => {
  const text = [
    "configVersion: 1",
    "inputDir: ./input",
    "outputDir: ./output",
    "prompt: translate",
    "logging:",
    "  enabled: false",
  ].join("\n");

  const result = upgradeConfigText(text);

  assertEquals(result.changed, true);
  assertEquals(result.fromVersion, 1);
  assertEquals(result.toVersion, 2);
  assertEquals(result.appendedKeys, ["configVersion", "preprocess"]);
  assertEquals(result.text.includes("configVersion: 2"), true);
  assertEquals(result.text.includes("preprocess:"), true);
  assertEquals(result.text.includes("intermediateDir: .intermediate"), true);
});

Deno.test("upgradeConfigText does nothing when known blocks exist", () => {
  const text = [
    "configVersion: 2",
    "inputDir: ./input",
    "outputDir: ./output",
    "prompt: translate",
    "preprocess:",
    "  aspectPad:",
    "    enabled: false",
    "    fill: transparent",
    "    cropBackToOriginal: false",
    "    intermediateDir: .intermediate",
    "logging:",
    "  enabled: false",
  ].join("\n");

  const result = upgradeConfigText(text);

  assertEquals(result.changed, false);
  assertEquals(result.appendedKeys, []);
  assertEquals(result.text, text);
});

Deno.test("upgradeConfigText rejects full update with comments unless allowed", () => {
  const text = [
    "# comment",
    "inputDir: ./input",
    "outputDir: ./output",
    "prompt: translate",
  ].join("\n");

  assertThrows(
    () => upgradeConfigText(text, { fullUpdate: true }),
    Error,
    "Full config update would drop comments",
  );
});

Deno.test("upgradeConfigText full update rewrites complete config when allowed", () => {
  const text = [
    "# comment",
    "inputDir: ./input",
    "outputDir: ./output",
    "prompt: translate",
  ].join("\n");

  const result = upgradeConfigText(text, { fullUpdate: true, allowDropComments: true });

  assertEquals(result.fullUpdate, true);
  assertEquals(result.fromVersion, 0);
  assertEquals(result.toVersion, 2);
  assertEquals(result.text.includes("# comment"), false);
  assertEquals(result.text.includes("configVersion: 2"), true);
  assertEquals(result.text.includes("logging:"), true);
  assertEquals(result.text.includes("preprocess:"), true);
  assertEquals(result.text.includes("enabled: false"), true);
});

Deno.test("upgradeConfigText validates config before updating", () => {
  const text = [
    "inputDir: ./input",
    "outputDir: ./output",
    "prompt: ''",
  ].join("\n");

  assertThrows(() => upgradeConfigText(text), Error, "prompt is required");
});

Deno.test("upgradeConfigFile dry-run does not write", async () => {
  const writes: string[] = [];
  const result = await upgradeConfigFile("config.yaml", {
    dryRun: true,
    readTextFile: () => Promise.resolve("inputDir: ./input\noutputDir: ./output\nprompt: x\n"),
    writeTextFile: (_path, text) => {
      writes.push(String(text));
      return Promise.resolve();
    },
  });

  assertEquals(result.changed, true);
  assertEquals(writes, []);
});

Deno.test("upgradeConfigText rejects non-object config", () => {
  assertThrows(
    () => upgradeConfigText("- a\n- b\n"),
    Error,
    "Config file must contain a YAML object",
  );
});
