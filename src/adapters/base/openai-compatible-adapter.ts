import { dirname } from "@std/path";
import type { ImageEditRequest, ImageEditResult, OpenAIConfig } from "../../shared/types.ts";
import { ApiError, classifyFetchError, classifyHttpError } from "../../openai/error-classifier.ts";
import { parseImageEditResponse } from "../../openai/response-parser.ts";
import type { ImageAdapter } from "../image-adapter.ts";
import { createHttpTransport } from "../http-transport.ts";
import type { HttpTransport } from "../http-transport.ts";

export type ResolvedRequestOptions = {
  size: NonNullable<ImageEditRequest["size"]>;
  quality?: string;
};

export abstract class OpenAICompatibleBaseAdapter implements ImageAdapter {
  constructor(
    protected readonly config: OpenAIConfig,
    protected readonly apiKey: string,
    protected readonly transport: HttpTransport = createHttpTransport(config),
  ) {}

  close(): void {
    this.transport.close();
  }

  async editImage(request: ImageEditRequest): Promise<ImageEditResult> {
    const imageBytes = await Deno.readFile(request.imagePath);
    const requestOptions = await this.resolveRequestOptions(request, imageBytes);
    const response = await this.sendEditsRequest(request, imageBytes, requestOptions);
    return await this.parseResponse(request, response);
  }

  protected abstract resolveRequestOptions(
    request: ImageEditRequest,
    imageBytes: Uint8Array,
  ): Promise<ResolvedRequestOptions>;

  protected async parseResponse(
    request: ImageEditRequest,
    response: Response,
  ): Promise<ImageEditResult> {
    const responseText = await response.text();
    if (!response.ok) {
      throw classifyHttpError(response.status, responseText, response.headers);
    }

    const parsed = await this.parseSuccessfulResponse(request, response, responseText);
    if (parsed.bytes) {
      return {
        bytes: parsed.bytes,
        outputFormat: parsed.outputFormat,
        width: parsed.width,
        height: parsed.height,
        byteCount: parsed.byteCount,
        revisedPrompt: parsed.revisedPrompt,
        usage: parsed.usage,
      };
    }

    if (parsed.imageUrl) {
      const downloaded = await this.downloadImage(
        resolveImageUrl(
          parsed.imageUrl,
          response.url || `${normalizeBaseUrl(this.config.baseUrl)}/images/edits`,
        ),
      );
      return {
        bytes: downloaded.bytes,
        outputFormat: downloaded.outputFormat ?? parsed.outputFormat,
        width: parsed.width,
        height: parsed.height,
        byteCount: parsed.byteCount,
        revisedPrompt: parsed.revisedPrompt,
        usage: parsed.usage,
      };
    }

    throw new ApiError({
      kind: "invalid_response",
      retryable: false,
      stopRun: false,
      message: "Invalid image edit response: parser returned neither bytes nor image URL",
      status: response.status,
    });
  }

  private async parseSuccessfulResponse(
    request: ImageEditRequest,
    response: Response,
    responseText: string,
  ) {
    try {
      return parseImageEditResponse(JSON.parse(responseText));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const artifactPath = await saveInvalidResponseArtifact({
        artifactPath: request.responseArtifactPath,
        requestUrl: response.url,
        status: response.status,
        responseHeaders: response.headers,
        responseText,
      });
      throw new ApiError({
        kind: "invalid_response",
        retryable: false,
        stopRun: false,
        message: artifactPath
          ? `Invalid image edit response: ${message}. Saved raw response to ${artifactPath}`
          : `Invalid image edit response: ${message}`,
        status: response.status,
      });
    }
  }

  protected async sendEditsRequest(
    request: ImageEditRequest,
    imageBytes: Uint8Array,
    requestOptions: ResolvedRequestOptions,
  ): Promise<Response> {
    const form = new FormData();
    form.set("model", this.config.model);
    form.set("prompt", request.prompt);
    setFormFieldIfNotAuto(form, "size", requestOptions.size);
    setOptionalFormField(form, "quality", requestOptions.quality);
    setFormFieldIfNotAuto(form, "background", this.config.image.background);
    form.set("output_format", this.config.image.outputFormat);
    form.set(
      "image",
      new Blob([toArrayBuffer(imageBytes)], { type: inferImageMimeType(request.imagePath) }),
      fileNameFromPath(request.imagePath),
    );

    try {
      return await this.transport.fetch(`${normalizeBaseUrl(this.config.baseUrl)}/images/edits`, {
        method: "POST",
        headers: buildHeaders({
          Authorization: `Bearer ${this.apiKey}`,
        }, this.config.userAgent),
        body: form,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw classifyFetchError(error);
    }
  }

  private async downloadImage(url: string): Promise<{ bytes: Uint8Array; outputFormat?: string }> {
    let response: Response;
    try {
      response = await this.transport.fetch(url, {
        method: "GET",
        headers: buildHeaders({}, this.config.userAgent),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw classifyFetchError(error);
    }

    if (!response.ok) {
      const text = await response.text();
      throw classifyHttpError(response.status, text, response.headers);
    }

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      outputFormat: inferOutputFormatFromContentType(response.headers.get("content-type")) ??
        inferOutputFormatFromUrl(url),
    };
  }
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function inferOutputFormatFromContentType(contentType: string | null): string | undefined {
  if (!contentType) return undefined;
  const normalized = contentType.toLowerCase();
  if (normalized.includes("image/png")) return "png";
  if (normalized.includes("image/webp")) return "webp";
  if (normalized.includes("image/jpeg") || normalized.includes("image/jpg")) return "jpeg";
  return undefined;
}

function inferOutputFormatFromUrl(url: string): string | undefined {
  const normalized = url.toLowerCase();
  if (normalized.includes(".png")) return "png";
  if (normalized.includes(".webp")) return "webp";
  if (normalized.includes(".jpg") || normalized.includes(".jpeg")) return "jpeg";
  return undefined;
}

function resolveImageUrl(imageUrl: string, responseUrl: string): string {
  return new URL(imageUrl, responseUrl).toString();
}

async function saveInvalidResponseArtifact(options: {
  artifactPath?: string;
  requestUrl: string;
  status: number;
  responseHeaders: Headers;
  responseText: string;
}): Promise<string | undefined> {
  if (!options.artifactPath) return undefined;

  await Deno.mkdir(dirname(options.artifactPath), { recursive: true });
  const payload = {
    requestUrl: options.requestUrl,
    status: options.status,
    responseHeaders: Object.fromEntries(options.responseHeaders.entries()),
    responseText: options.responseText,
  };
  await Deno.writeTextFile(options.artifactPath, JSON.stringify(payload, null, 2));
  return options.artifactPath;
}

function setFormFieldIfNotAuto(form: FormData, name: string, value: string): void {
  if (value !== "auto") {
    form.set(name, value);
  }
}

function setOptionalFormField(form: FormData, name: string, value: string | undefined): void {
  if (value) form.set(name, value);
}

export function buildHeaders(
  base: Record<string, string>,
  userAgent?: string,
): Record<string, string> {
  return userAgent ? { ...base, "User-Agent": userAgent } : base;
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}
