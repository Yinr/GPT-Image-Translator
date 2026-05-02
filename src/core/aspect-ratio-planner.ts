import type { OpenAIImageSize } from "../shared/types.ts";

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AspectRatioPlan {
  apiSize: Exclude<OpenAIImageSize, "auto">;
  source: ImageDimensions;
  canvas: ImageDimensions;
  sourceRect: Rect;
}

interface SupportedCanvas {
  apiSize: Exclude<OpenAIImageSize, "auto">;
  width: number;
  height: number;
}

const SUPPORTED_CANVASES: SupportedCanvas[] = [
  { apiSize: "1024x1024", width: 1024, height: 1024 },
  { apiSize: "1024x1536", width: 1024, height: 1536 },
  { apiSize: "1536x1024", width: 1536, height: 1024 },
];

export function planAspectRatioPadding(source: ImageDimensions): AspectRatioPlan {
  assertPositiveInteger(source.width, "source.width");
  assertPositiveInteger(source.height, "source.height");

  const selected = selectSupportedCanvas(source);
  const canvas = scaleCanvasToContain(source, selected);
  const sourceRect = centerRect(source, canvas);

  return {
    apiSize: selected.apiSize,
    source: { ...source },
    canvas,
    sourceRect,
  };
}

export function mapRectToOutput(
  rect: Rect,
  inputCanvas: ImageDimensions,
  output: ImageDimensions,
): Rect {
  assertPositiveInteger(inputCanvas.width, "inputCanvas.width");
  assertPositiveInteger(inputCanvas.height, "inputCanvas.height");
  assertPositiveInteger(output.width, "output.width");
  assertPositiveInteger(output.height, "output.height");
  assertRect(rect, "rect");

  const scaleX = output.width / inputCanvas.width;
  const scaleY = output.height / inputCanvas.height;

  return {
    x: Math.round(rect.x * scaleX),
    y: Math.round(rect.y * scaleY),
    width: Math.round(rect.width * scaleX),
    height: Math.round(rect.height * scaleY),
  };
}

function selectSupportedCanvas(source: ImageDimensions): SupportedCanvas {
  const sourceRatio = source.width / source.height;

  return SUPPORTED_CANVASES.map((canvas, index) => {
    const candidate = scaleCanvasToContain(source, canvas);
    return {
      canvas,
      index,
      ratioDelta: Math.abs(sourceRatio - canvas.width / canvas.height),
      paddingArea: candidate.width * candidate.height - source.width * source.height,
    };
  }).sort((a, b) => {
    const ratioOrder = a.ratioDelta - b.ratioDelta;
    if (ratioOrder !== 0) return ratioOrder;

    const paddingOrder = a.paddingArea - b.paddingArea;
    if (paddingOrder !== 0) return paddingOrder;

    return a.index - b.index;
  })[0].canvas;
}

function scaleCanvasToContain(source: ImageDimensions, canvas: SupportedCanvas): ImageDimensions {
  const scale = Math.max(source.width / canvas.width, source.height / canvas.height);
  return {
    width: Math.ceil(canvas.width * scale),
    height: Math.ceil(canvas.height * scale),
  };
}

function centerRect(source: ImageDimensions, canvas: ImageDimensions): Rect {
  return {
    x: Math.floor((canvas.width - source.width) / 2),
    y: Math.floor((canvas.height - source.height) / 2),
    width: source.width,
    height: source.height,
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertRect(rect: Rect, name: string): void {
  assertPositiveInteger(rect.width, `${name}.width`);
  assertPositiveInteger(rect.height, `${name}.height`);
  if (!Number.isInteger(rect.x) || rect.x < 0) {
    throw new Error(`${name}.x must be a non-negative integer`);
  }
  if (!Number.isInteger(rect.y) || rect.y < 0) {
    throw new Error(`${name}.y must be a non-negative integer`);
  }
}
