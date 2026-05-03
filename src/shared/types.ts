export interface AppConfig {
  configVersion: number;
  inputDir: string;
  outputDir: string;
  prompt: string;
  openai: OpenAIConfig;
  scan: ScanConfig;
  output: OutputConfig;
  queue: QueueConfig;
  retry: RetryConfig;
  storage: StorageConfig;
  preprocess: PreprocessConfig;
  logging: LoggingConfig;
}

export interface OpenAIConfig {
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  adapter: OpenAIAdapterKind;
  model: string;
  timeoutMs: number;
  image: OpenAIImageConfig;
}

export type OpenAIAdapterKind = "openai" | "gpt2api" | "pic2api";

export interface OpenAIImageConfig {
  size: OpenAIImageSize;
  quality: OpenAIImageQuality;
  background: OpenAIImageBackground;
  outputFormat: OpenAIImageOutputFormat;
}

export type OpenAIImageSize = "auto" | "1024x1024" | "1024x1536" | "1536x1024";

export type OpenAIImageQuality = "auto" | "low" | "medium" | "high";

export type OpenAIImageBackground = "auto" | "opaque" | "transparent";

export type OpenAIImageOutputFormat = "png" | "webp" | "jpeg";

export interface ScanConfig {
  recursive: boolean;
  extensions: string[];
}

export interface OutputConfig {
  skipExisting: boolean;
  overwrite: boolean;
  formatFromApi: boolean;
}

export interface QueueConfig {
  resume: boolean;
  concurrency: number;
  minDelayMs: number;
  failFast: boolean;
}

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export interface StorageConfig {
  sqlitePath: string;
}

export interface PreprocessConfig {
  aspectPad: AspectPadConfig;
}

export interface AspectPadConfig {
  enabled: boolean;
  fill: AspectPadFill;
  cropBackToOriginal: boolean;
  intermediateDir: string;
}

export type AspectPadFill = "transparent" | "white";

export interface LoggingConfig {
  enabled: boolean;
  level: LogLevel;
  dir: string;
  console: boolean;
  file: boolean;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ImageFile {
  absolutePath: string;
  relativePath: string;
}

export interface OutputPath {
  absolutePath: string;
  relativePath: string;
}

export interface ImageEditResult {
  bytes: Uint8Array;
  outputFormat: string;
  width?: number;
  height?: number;
  byteCount?: number;
  revisedPrompt?: string;
  usage?: unknown;
}

export interface ImageEditRequest {
  imagePath: string;
  prompt: string;
  size?: ImageRequestSize;
  responseArtifactPath?: string;
}

export type ImageRequestSize = OpenAIImageSize | `${number}x${number}`;

export interface ApiErrorInfo {
  kind: ApiErrorKind;
  retryable: boolean;
  stopRun: boolean;
  message: string;
  status?: number;
  retryAfterMs?: number;
}

export type ApiErrorKind =
  | "network_error"
  | "timeout"
  | "rate_limit"
  | "server_error"
  | "authentication_error"
  | "permission_error"
  | "bad_request"
  | "not_found"
  | "unprocessable_entity"
  | "invalid_response"
  | "unknown_error";

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  exhausted: boolean;
}

export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export type JobStatus =
  | "pending"
  | "running"
  | "retryable"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

export type AttemptStatus = "succeeded" | "retryable" | "failed";

export interface RunRecord {
  id: string;
  status: RunStatus;
  configHash: string;
  inputDir: string;
  outputDir: string;
  startedAt: string;
  finishedAt?: string;
  totalJobs: number;
  succeededJobs: number;
  failedJobs: number;
  skippedJobs: number;
}

export interface JobRecord {
  id: string;
  runId: string;
  inputPath: string;
  outputPath: string;
  status: JobStatus;
  attempts: number;
  nextAttemptAt?: string;
  lastErrorType?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface AttemptRecord {
  id: string;
  jobId: string;
  attemptNo: number;
  status: AttemptStatus;
  httpStatus?: number;
  errorType?: string;
  errorMessage?: string;
  retryAfterMs?: number;
  durationMs?: number;
  startedAt: string;
  finishedAt?: string;
}

export interface OutputRecord {
  id: string;
  jobId: string;
  outputPath: string;
  outputFormat: string;
  width?: number;
  height?: number;
  byteCount?: number;
  revisedPrompt?: string;
  usageJson?: string;
  createdAt: string;
}

export interface ProcessingMetadataRecord {
  id: string;
  jobId: string;
  enabled: boolean;
  apiSize?: OpenAIImageSize;
  sourceWidth?: number;
  sourceHeight?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  sourceRectX?: number;
  sourceRectY?: number;
  sourceRectWidth?: number;
  sourceRectHeight?: number;
  fill?: AspectPadFill;
  cropBackToOriginal: boolean;
  uncroppedOutputPath?: string;
  createdAt: string;
}
