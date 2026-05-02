import { assertEquals, assertThrows } from "@std/assert";
import { parseImageEditResponse } from "../src/openai/response-parser.ts";

Deno.test("parseImageEditResponse decodes b64 image data", () => {
  const result = parseImageEditResponse({
    output_format: "png",
    usage: { total_tokens: 1 },
    data: [{ b64_json: btoa("abc"), bytes: 3, width: 1, height: 2, revised_prompt: "x" }],
  });

  assertEquals([...result.bytes], [97, 98, 99]);
  assertEquals(result.outputFormat, "png");
  assertEquals(result.width, 1);
  assertEquals(result.height, 2);
  assertEquals(result.byteCount, 3);
  assertEquals(result.revisedPrompt, "x");
});

Deno.test("parseImageEditResponse rejects missing b64_json", () => {
  assertThrows(
    () => parseImageEditResponse({ data: [{}] }),
    Error,
    "data[0].b64_json",
  );
});
