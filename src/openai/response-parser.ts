import { decodeBase64 } from "@std/encoding/base64";
import type { ImageEditResult } from "../shared/types.ts";

type RecordValue = Record<string, unknown>;

export function parseImageEditResponse(json: unknown): ImageEditResult {
  if (!isRecord(json)) {
    throw new Error("Image edit response must be a JSON object");
  }

  const data = json.data;
  const first = Array.isArray(data) ? data[0] : undefined;
  if (!isRecord(first) || typeof first.b64_json !== "string") {
    throw new Error("Image edit response is missing data[0].b64_json");
  }

  return {
    bytes: decodeBase64(first.b64_json),
    outputFormat: typeof json.output_format === "string" ? json.output_format : "png",
    width: typeof first.width === "number" ? first.width : undefined,
    height: typeof first.height === "number" ? first.height : undefined,
    byteCount: typeof first.bytes === "number" ? first.bytes : undefined,
    revisedPrompt: typeof first.revised_prompt === "string" ? first.revised_prompt : undefined,
    usage: json.usage,
  };
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
