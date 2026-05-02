import type {
  OpenAIImageBackground,
  OpenAIImageOutputFormat,
  OpenAIImageQuality,
  OpenAIImageSize,
} from "../shared/types.ts";

export const OPENAI_IMAGE_SIZES = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
] as const satisfies readonly OpenAIImageSize[];

export const OPENAI_IMAGE_QUALITIES = [
  "auto",
  "low",
  "medium",
  "high",
] as const satisfies readonly OpenAIImageQuality[];

export const OPENAI_IMAGE_BACKGROUNDS = [
  "auto",
  "opaque",
  "transparent",
] as const satisfies readonly OpenAIImageBackground[];

export const OPENAI_IMAGE_OUTPUT_FORMATS = [
  "png",
  "webp",
  "jpeg",
] as const satisfies readonly OpenAIImageOutputFormat[];
