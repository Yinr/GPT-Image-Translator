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
- `output.formatFromApi` controls whether the final output path follows response `output_format` or
  keeps the configured `openai.image.outputFormat` extension.
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
  # Optional: use a direct key in a local private config file.
  # apiKey: sk-your-key
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

logging:
  enabled: false
  level: info
  dir: ./logs
```

Logging behavior notes:

- `logging.enabled: false` is the default and should preserve current behavior.
- The initial logging feature should focus on local CLI diagnostics, not distributed telemetry.
- User-facing progress output and diagnostic log persistence should be treated as related but
  distinct concerns.
- The project should not adopt `@std/log` as a new foundation because Deno marks it as no longer
  recommended and likely removable in the future.

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
  -> choose final output path according to output.formatFromApi
  -> write output bytes to the chosen path
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
- Always: Allow API keys to come from either `openai.apiKey` or `openai.apiKeyEnv`, with
  `openai.apiKey` taking precedence when both are set.
- Always: Keep user-facing progress output readable even if file-based diagnostic logging is
  disabled.
- Always: Avoid writing raw API keys or other secrets into logs, persisted log files, or structured
  diagnostics.
- Always: Preserve directory structure from input to output.
- Always: Persist job status before and after API attempts.
- Always: Decode `data[0].b64_json` before writing output files.
- Always: Use response `output_format` for the final extension when `output.formatFromApi` is
  enabled.
- Always: Keep the configured planned extension when `output.formatFromApi` is disabled.
- Always: Prefer Deno Standard Library or mature Deno libraries over project-local utility
  implementations for common infrastructure.
- Always: Prefer JSR dependencies and record any exception in the spec or implementation plan.
- Ask first: Adding a web framework, changing storage away from SQLite, or introducing an external
  queue service.
- Never: Commit real API keys, temporary API responses, or generated image outputs.

## Success Criteria

- A YAML config can run a directory translation job.
- The scanner recursively finds supported image files in stable order.
- Output paths mirror input paths and follow either the API output format or the configured planned
  extension, depending on `output.formatFromApi`.
- The OpenAI-compatible image edit response is parsed and written correctly.
- Transient failures are retried with backoff.
- Authentication and permission errors stop the run with a clear error.
- Interrupted runs can resume without reprocessing completed outputs.
- Core queue and storage logic can be reused by a future Web UI.

## Future Architecture Considerations

The current implementation assumes one provider and one active API key source per run. A later major
version may expand this into a dedicated account-scheduling layer.

Another future expansion is a dedicated local logging module for CLI diagnostics.

Expected logging direction:

- Add an internal logging module instead of adopting `@std/log` as a new long-term dependency.
- Support configurable log levels such as `debug`, `info`, `warn`, and `error`.
- Support optional file logging under a configurable directory, defaulting to `./logs`.
- Keep log persistence disabled by default so basic CLI use remains quiet and simple.
- Keep user-facing progress messages separate from lower-level diagnostic records where practical.

Design constraints for that future work:

- Log configuration should be explicit in YAML and preserve current behavior when disabled.
- The logging module should be reusable by queue, storage, and provider code without forcing CLI
  formatting concerns downward.
- File logging should be safe on Windows and create directories lazily when needed.
- The first implementation step should remain intentionally small: level filtering, optional file
  sink, and a stable logger interface.

Expected future direction:

- Support multiple API keys for one provider without breaking the current single-key path.
- Add explicit key-selection strategies, including primary-with-failover and balanced usage.
- Allow queue concurrency to scale with the number of healthy available keys rather than treating
  all requests as if they share one identical credential.
- Persist masked key identity or key slot metadata per attempt so operators can diagnose routing
  behavior without exposing raw secrets.
- Eventually generalize from a single-provider key pool to a multi-provider account pool with health
  tracking and policy-driven routing.

Design constraints for that future work:

- Key/provider selection should live in a dedicated scheduling module, not inside the low-level
  image client alone.
- Secrets must never be written to logs, CLI output, or persisted diagnostic records.
- Provider-specific request differences should remain below the queue orchestration layer whenever
  possible.
- The first implementation step should remain intentionally small: one provider, multiple keys,
  deterministic rotation.

## Open Questions

- Whether `gpt-image-2-2k` or `gpt-image-2-4k` should be exposed as presets.
- Which `gpt-image-2` image parameters are supported by the official/compatible API, especially
  `size`, `quality`, `background`, and `output_format`; supported options are now exposed in config,
  with `auto` values omitted from the request payload.
- For future multi-key scheduling, should attempt metadata store only a masked key label, or also a
  separate non-secret logical account id?
- For future multi-provider support, should provider failover be automatic, policy-driven, or always
  explicitly configured?
- For future key balancing, should scheduling remain simple round-robin at first, or account for
  cooldowns, quotas, and recent rate limits from the beginning?
- For future logging, should file output be one file per run, one rolling shared file, or both?
- For future logging, should progress output and diagnostic logs share one formatter, or remain
  intentionally separate?
- Whether prompt should support per-directory or per-file overrides later.
- Whether cancellation and pause controls are needed in the first CLI release or only for the future
  Web UI.
