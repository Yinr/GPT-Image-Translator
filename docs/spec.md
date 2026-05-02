# Spec: GPT Image Translator

## Objective

Build a Deno command-line program that translates images in a directory by sending each image to an
OpenAI-compatible `gpt-image-2` image edit API with a configured prompt. The program must preserve
the input directory structure in the output directory, support YAML configuration, persist job state
in SQLite, retry transient failures, and resume from interruptions.

The initial user is a local operator running batch image translation jobs. The design should keep
core execution independent from the CLI so a future web UI can reuse the same queue, storage, and
API layers.

## Confirmed API Behavior

The API service configured in `.local/smoke-test/api-info.md` has been tested manually. Temporary
scripts and notes are stored under `.local/smoke-test/` and should remain untracked.

- `GET /v1/models` works and lists `gpt-image-2`, `gpt-image-2-2k`, and `gpt-image-2-4k`.
- `POST /v1/images/edits` works for `.local/smoke-test/037.jpg`.
- Image edit responses are JSON, not raw image bytes.
- Output image bytes are returned as base64 in `data[0].b64_json`.
- Output extension should come from top-level `output_format`, observed as `png`.
- A real image edit request took about 205 seconds, so long timeouts and durable job state are
  required.

## Tech Stack

- Runtime: Deno
- Language: TypeScript
- Config file: YAML
- Persistent state: SQLite
- API: OpenAI-compatible `/v1/images/edits`
- Tests: Deno test runner

Preferred libraries:

- Use Deno Standard Library where available: `@std/path`, `@std/fs`, `@std/cli`, `@std/yaml`, and
  `@std/encoding`.
- Prefer JSR sources for dependencies. Only use npm or URL imports when no suitable JSR package
  exists or a concrete compatibility issue requires it.
- Use `jsr:@db/sqlite` for SQLite unless a concrete compatibility issue appears.
- Avoid custom implementations for common filesystem traversal, path parsing, CLI parsing, YAML
  parsing, and base64 decoding.

## Commands

Planned commands:

```bash
deno task check
deno task test
deno task fmt
deno task translate --config ./config.example.yaml
```

Direct execution:

```bash
deno run -A src/main.ts --config ./config.example.yaml
```

## Project Structure

```text
src/
  main.ts                 Program entrypoint
  cli/                    CLI args, command execution, terminal output
  config/                 YAML loading, defaults, validation, merge logic
  core/                   High-level pipeline, scanner, path mapping, events
  queue/                  Durable job queue, scheduler, runner, concurrency
  openai/                 OpenAI-compatible image edit client and retry logic
  storage/                SQLite database, migrations, stores
  fs/                     File writing, path helpers, MIME helpers
  shared/                 Shared types, time utilities, result helpers
tests/                    Unit and integration tests
docs/                     Spec and implementation plan
.local/smoke-test/        Local temporary API notes and samples, untracked
```

## Code Style

Use small modules with explicit typed inputs and outputs. Keep CLI concerns out of core execution
code.

Example style:

```ts
export interface ImageEditResult {
  bytes: Uint8Array;
  outputFormat: string;
  width?: number;
  height?: number;
  revisedPrompt?: string;
  usage?: unknown;
}

export function parseImageEditResponse(json: unknown): ImageEditResult {
  if (!isRecord(json)) {
    throw new Error("Image edit response must be a JSON object");
  }

  const first = Array.isArray(json.data) ? json.data[0] : undefined;
  if (!isRecord(first) || typeof first.b64_json !== "string") {
    throw new Error("Image edit response is missing data[0].b64_json");
  }

  return {
    bytes: decodeBase64(first.b64_json),
    outputFormat: typeof json.output_format === "string" ? json.output_format : "png",
  };
}
```

## Configuration

Configuration precedence:

```text
defaults < YAML config < CLI flags
```

Representative YAML:

```yaml
inputDir: ./input
outputDir: ./output

openai:
  baseUrl: http://127.0.0.1:3000/v1
  apiKeyEnv: OPENAI_API_KEY
  model: gpt-image-2

prompt: |
  Translate all text in the image to Simplified Chinese while preserving
  the original layout, visual composition, typography style, and image content.

scan:
  recursive: true
  extensions:
    - .jpg
    - .jpeg
    - .png
    - .webp

output:
  skipExisting: true
  overwrite: false
  formatFromApi: true

queue:
  resume: true
  concurrency: 1
  minDelayMs: 1000
  failFast: false

retry:
  maxAttempts: 5
  initialDelayMs: 3000
  maxDelayMs: 300000
  backoffFactor: 2

storage:
  sqlitePath: ./state/translator.db
```

## Queue Model

Each input image becomes one durable job.

Job statuses:

- `pending`: discovered and ready to run
- `running`: currently executing
- `retryable`: failed transiently and waiting for `next_attempt_at`
- `succeeded`: output successfully written
- `failed`: permanently failed
- `skipped`: intentionally skipped
- `cancelled`: cancelled before completion

Execution flow:

```text
scan input directory
  -> map input paths to output paths
  -> upsert jobs in SQLite
  -> schedule pending and due retryable jobs
  -> run with configured concurrency and delay
  -> call /v1/images/edits
  -> decode data[0].b64_json
  -> write output using output_format extension
  -> persist status, attempts, and metadata
```

## Error Handling

Retryable failures:

- Network errors
- Request timeout
- HTTP 408
- HTTP 409
- HTTP 425
- HTTP 429
- HTTP 500
- HTTP 502
- HTTP 503
- HTTP 504

Non-retryable failures:

- HTTP 400
- HTTP 401
- HTTP 403
- HTTP 404
- HTTP 422
- Invalid config
- Unsupported file type
- Missing input file
- Missing `data[0].b64_json` in a successful response

Special handling:

- `401` and `403` should stop the whole run because credentials or permissions are invalid.
- `429` should honor `Retry-After` when present, otherwise use exponential backoff.
- A job that reaches `retry.maxAttempts` becomes `failed`.

## Testing Strategy

- Unit tests for scanner, path mapping, response parsing, error classification, retry policy, and
  scheduler.
- Storage tests for SQLite migrations and job state transitions.
- Integration tests for pipeline resume behavior using a fake image edit client.
- Real API smoke tests must be opt-in and guarded by environment variables.

## Boundaries

- Always: Treat API keys as secrets and avoid printing them.
- Always: Preserve directory structure from input to output.
- Always: Persist job status before and after API attempts.
- Always: Decode `data[0].b64_json` and use `output_format` for the output extension.
- Always: Prefer Deno Standard Library or mature Deno libraries over project-local utility
  implementations for common infrastructure.
- Always: Prefer JSR dependencies and record any exception in the spec or implementation plan.
- Ask first: Adding a web framework, changing storage away from SQLite, or introducing an external
  queue service.
- Never: Commit real API keys, temporary API responses, or generated image outputs.

## Success Criteria

- A YAML config can run a directory translation job.
- The scanner recursively finds supported image files in stable order.
- Output paths mirror input paths and use the API output format extension.
- The OpenAI-compatible image edit response is parsed and written correctly.
- Transient failures are retried with backoff.
- Authentication and permission errors stop the run with a clear error.
- Interrupted runs can resume without reprocessing completed outputs.
- Core queue and storage logic can be reused by a future Web UI.

## Open Questions

- Whether `gpt-image-2-2k` or `gpt-image-2-4k` should be exposed as presets.
- Which `gpt-image-2` image parameters are supported by the official/compatible API, especially
  `size`, `quality`, `background`, and `output_format`; supported options are now exposed in config,
  with `auto` values omitted from the request payload.
- Whether prompt should support per-directory or per-file overrides later.
- Whether cancellation and pause controls are needed in the first CLI release or only for the future
  Web UI.
