import { decodeBase64 } from "@std/encoding/base64";
import type { ImageEditResult } from "../shared/types.ts";

type RecordValue = Record<string, unknown>;

export interface ParsedImageEditResponse extends Omit<ImageEditResult, "bytes"> {
  bytes?: Uint8Array;
  imageUrl?: string;
}

export function parseImageEditResponse(json: unknown): ParsedImageEditResponse {
  if (!isRecord(json)) {
    throw new Error("Image edit response must be a JSON object");
  }

  const data = json.data;
  const first = Array.isArray(data) ? data[0] : undefined;
  if (!isRecord(first)) {
    throw new Error("Image edit response is missing data[0]");
  }

  const outputFormat = typeof json.output_format === "string"
    ? json.output_format
    : typeof first.url === "string"
    ? inferOutputFormatFromUrl(first.url)
    : "png";

  if (typeof first.b64_json === "string") {
    return {
      bytes: decodeBase64(first.b64_json),
      outputFormat,
      width: typeof first.width === "number" ? first.width : undefined,
      height: typeof first.height === "number" ? first.height : undefined,
      byteCount: typeof first.bytes === "number" ? first.bytes : undefined,
      revisedPrompt: typeof first.revised_prompt === "string" ? first.revised_prompt : undefined,
      usage: json.usage,
    };
  }

  if (typeof first.url === "string") {
    return {
      imageUrl: first.url,
      outputFormat,
      width: typeof first.width === "number" ? first.width : undefined,
      height: typeof first.height === "number" ? first.height : undefined,
      byteCount: typeof first.bytes === "number" ? first.bytes : undefined,
      revisedPrompt: typeof first.revised_prompt === "string" ? first.revised_prompt : undefined,
      usage: json.usage,
    };
  }

  throw new Error("Image edit response is missing data[0].b64_json or data[0].url");
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferOutputFormatFromUrl(url: string): string {
  const normalized = url.toLowerCase();
  if (normalized.includes(".png")) return "png";
  if (normalized.includes(".webp")) return "webp";
  if (normalized.includes(".jpg") || normalized.includes(".jpeg")) return "jpeg";
  return "png";
}
