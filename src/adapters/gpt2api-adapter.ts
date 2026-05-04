import { encodeBase64 } from "@std/encoding/base64";
import type { ImageEditRequest, ImageEditResult } from "../shared/types.ts";
import { classifyFetchError, classifyHttpError } from "../openai/error-classifier.ts";
import {
  buildHeaders,
  normalizeBaseUrl,
  OpenAICompatibleBaseAdapter,
} from "./base/openai-compatible-adapter.ts";
import type { ResolvedRequestOptions } from "./base/openai-compatible-adapter.ts";

export class Gpt2ApiAdapter extends OpenAICompatibleBaseAdapter {
  override async editImage(request: ImageEditRequest): Promise<ImageEditResult> {
    const imageBytes = await Deno.readFile(request.imagePath);
    const requestOptions = await this.resolveRequestOptions(request, imageBytes);
    const response = await this.sendEditsRequest(request, imageBytes, requestOptions);
    if (response.ok) return await this.parseResponse(request, response);

    const responseText = await response.text();
    if (!shouldUseReferenceGenerationsFallback(response.status, responseText)) {
      throw classifyHttpError(response.status, responseText, response.headers);
    }

    const fallbackResponse = await this.sendReferenceGenerationRequest(
      request,
      imageBytes,
      requestOptions,
    );
    return await this.parseResponse(request, fallbackResponse);
  }

  protected resolveRequestOptions(
    request: ImageEditRequest,
    _imageBytes: Uint8Array,
  ): Promise<ResolvedRequestOptions> {
    return Promise.resolve({
      size: request.size ?? this.config.image.size,
      quality: this.config.image.quality === "auto" ? undefined : this.config.image.quality,
    });
  }

  private async sendReferenceGenerationRequest(
    request: ImageEditRequest,
    imageBytes: Uint8Array,
    requestOptions: ResolvedRequestOptions,
  ): Promise<Response> {
    const body = {
      model: this.config.model,
      prompt: request.prompt,
      n: 1,
      ...(requestOptions.size !== "auto" ? { size: requestOptions.size } : {}),
      ...(requestOptions.quality ? { quality: requestOptions.quality } : {}),
      reference_images: [encodeBase64(imageBytes)],
    };

    try {
      return await this.fetchImpl(`${normalizeBaseUrl(this.config.baseUrl)}/images/generations`, {
        method: "POST",
        headers: buildHeaders({
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        }, this.config.userAgent),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw classifyFetchError(error);
    }
  }
}

function shouldUseReferenceGenerationsFallback(status: number, body: string): boolean {
  if ([404, 405, 415].includes(status)) return true;
  if (![400, 422].includes(status)) return false;

  const normalized = body.toLowerCase();
  return normalized.includes("reference_images") || normalized.includes("application/json") ||
    normalized.includes("images/generations") || normalized.includes("unsupported") ||
    normalized.includes("not support");
}
