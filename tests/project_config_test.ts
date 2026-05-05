import { assertEquals, assertThrows } from "@std/assert";
import { CURRENT_CONFIG_VERSION } from "../src/config/defaults.ts";
import {
  parseConfigDocument,
  ProjectConfig,
  readConfigDocumentVersion,
} from "../src/config/project-config.ts";

Deno.test("ProjectConfig resolves defaults and normalization from document", () => {
  const config = ProjectConfig.fromParsedDocument({
    inputDir: "./input",
    outputDir: "./output",
    prompt: "translate",
    openai: {
      baseUrl: "https://api.openai.com/v1/",
      apiKey: " test-key ",
      userAgent: "  default  ",
      proxy: "none",
      adapter: "OPENAI",
      model: "gpt-image-2",
      image: {
        size: "AUTO",
        quality: "HIGH",
        background: "OPAQUE",
        outputFormat: "PNG",
      },
    },
    scan: {
      extensions: ["JPG", ".PNG"],
    },
    logging: {
      level: "DEBUG",
      dir: "  ./custom-logs  ",
    },
  }).resolved;

  assertEquals(config.configVersion, 0);
  assertEquals(config.openai.baseUrl, "https://api.openai.com/v1");
  assertEquals(config.openai.apiKey, "test-key");
  assertEquals(config.openai.userAgent?.startsWith("GPT-Image-Translator/"), true);
  assertEquals(config.openai.proxy.url, "");
  assertEquals(config.openai.adapter, "openai");
  assertEquals(config.openai.image.quality, "high");
  assertEquals(config.scan.extensions, [".jpg", ".png"]);
  assertEquals(config.logging.level, "debug");
  assertEquals(config.logging.dir, "./custom-logs");
});

Deno.test("ProjectConfig marks outdated configs", () => {
  const projectConfig = ProjectConfig.fromParsedDocument({
    inputDir: "./input",
    outputDir: "./output",
    prompt: "translate",
  });

  assertEquals(projectConfig.isOutdated(), true);
});

Deno.test("ProjectConfig preserves current version configs as current", () => {
  const projectConfig = ProjectConfig.fromParsedDocument({
    configVersion: CURRENT_CONFIG_VERSION,
    inputDir: "./input",
    outputDir: "./output",
    prompt: "translate",
  });

  assertEquals(projectConfig.isOutdated(), false);
});

Deno.test("ProjectConfig serializes without undefined fields", () => {
  const serialized = ProjectConfig.serializeResolvedConfig(
    ProjectConfig.fromParsedDocument({
      inputDir: "./input",
      outputDir: "./output",
      prompt: "translate",
      openai: {
        apiKey: "test-key",
        userAgent: "",
      },
    }).resolved,
  );

  const openai = serialized.openai as Record<string, unknown>;
  assertEquals(Object.hasOwn(openai, "userAgent"), false);
});

Deno.test("parseConfigDocument rejects non-object YAML", () => {
  assertThrows(
    () => parseConfigDocument("- a\n- b\n"),
    Error,
    "Config file must contain a YAML object",
  );
});

Deno.test("readConfigDocumentVersion validates version", () => {
  assertEquals(readConfigDocumentVersion({}), 0);
  assertEquals(readConfigDocumentVersion({ configVersion: 2 }), 2);
  assertThrows(
    () => readConfigDocumentVersion({ configVersion: -1 }),
    Error,
    "configVersion must be a non-negative integer",
  );
});
