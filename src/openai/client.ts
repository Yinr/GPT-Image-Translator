import type { ImageEditRequest, ImageEditResult, OpenAIConfig } from "../shared/types.ts";
import { classifyFetchError, classifyHttpError } from "./error-classifier.ts";
import { parseImageEditResponse } from "./response-parser.ts";

export type FetchLike = typeof fetch;

export class OpenAIImageClient {
  constructor(
    private readonly config: OpenAIConfig,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async editImage(request: ImageEditRequest): Promise<ImageEditResult> {
    const imageBytes = await Deno.readFile(request.imagePath);
    const form = new FormData();
    form.set("model", this.config.model);
    form.set("prompt", request.prompt);
    setFormFieldIfNotAuto(form, "size", this.config.image.size);
    setFormFieldIfNotAuto(form, "quality", this.config.image.quality);
    setFormFieldIfNotAuto(form, "background", this.config.image.background);
    form.set("output_format", this.config.image.outputFormat);
    form.set(
      "image",
      new Blob([imageBytes], { type: inferImageMimeType(request.imagePath) }),
      fileNameFromPath(request.imagePath),
    );

    let response: Response;
    try {
      response = await this.fetchImpl(`${normalizeBaseUrl(this.config.baseUrl)}/images/edits`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw classifyFetchError(error);
    }

    const responseText = await response.text();
    if (!response.ok) {
      throw classifyHttpError(response.status, responseText, response.headers);
    }

    try {
      return parseImageEditResponse(JSON.parse(responseText));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw classifyHttpError(200, `Invalid image edit response: ${message}`, response.headers);
    }
  }
}

export function createOpenAIImageClient(
  config: OpenAIConfig,
  getEnv: (name: string) => string | undefined = Deno.env.get,
): OpenAIImageClient {
  const apiKey = getEnv(config.apiKeyEnv);
  if (!apiKey) {
    throw new Error(`Missing API key environment variable: ${config.apiKeyEnv}`);
  }

  return new OpenAIImageClient(config, apiKey);
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) || "image";
}

function inferImageMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function setFormFieldIfNotAuto(form: FormData, name: string, value: string): void {
  if (value !== "auto") {
    form.set(name, value);
  }
}
