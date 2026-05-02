# Implementation Plan: GPT Image Translator

## Overview

This project is now past the initial vertical-slice implementation. The current plan tracks two
things:

- The completed baseline that must stay stable.
- The next architecture and feature iterations that should be implemented in small, verified slices.

The program remains a Deno CLI first, with queue, storage, OpenAI client, and query logic kept
reusable for a future Web UI.

## Architecture Decisions

- Use a local SQLite-backed queue rather than only in-memory iteration because real image requests
  are slow and interruption recovery is required.
- Keep CLI as a thin adapter over core queue execution so a future Web UI can reuse the same
  modules.
- Use `/v1/images/edits` and parse `data[0].b64_json`; do not expect raw binary HTTP responses.
- Use the API response `output_format` for output file extension.
- Prefer Deno Standard Library for common functionality: filesystem walking, path handling, CLI
  parsing, YAML parsing, and base64 decoding.
- Prefer JSR dependencies. Use npm or URL imports only when no suitable JSR package exists or a
  concrete compatibility issue requires it.
- Use `jsr:@db/sqlite` for SQLite storage unless implementation testing reveals a blocker.
- Keep image API option values centralized so config validation and client behavior cannot drift.
- Treat image aspect-ratio preprocessing as a separate pipeline stage before the OpenAI client, not
  as OpenAI client responsibility.

## Current Baseline

### Completed Phase 1: Foundation

- [x] Deno project skeleton exists.
- [x] `deno task check`, `deno task test`, and `deno task fmt` are configured.
- [x] `src/main.ts` is the program entrypoint.
- [x] Source directories are split by concern: `cli`, `config`, `core`, `queue`, `openai`,
      `storage`, `fs`, `shared`, and `services`.

Verification:

- `deno task check`
- `deno task test`
- `deno task fmt`

### Completed Phase 2: Config, Files, and Response Parsing

- [x] YAML config loading works with defaults and validation.
- [x] `config.example.yaml` contains Chinese comments for all current user-facing fields.
- [x] Scanner recursively finds supported image files in stable order.
- [x] Output path mapping preserves input directory structure and blocks path escape.
- [x] Image edit response parser decodes `data[0].b64_json`.
- [x] Missing `output_format` defaults to `png`.

Verification:

- `deno test tests/config_test.ts tests/scanner_test.ts tests/path_map_test.ts tests/response_parser_test.ts`

### Completed Phase 3: SQLite Queue

- [x] SQLite migrations initialize idempotently.
- [x] Runs, jobs, attempts, and outputs are persisted.
- [x] Jobs can be planned, upserted, queried, and updated.
- [x] Pending and due retryable jobs are scheduled.
- [x] Failed jobs are not retried unless future functionality explicitly supports it.

Verification:

- `deno test tests/storage_test.ts tests/scheduler_test.ts`

### Completed Phase 4: OpenAI Client and Retry

- [x] OpenAI-compatible image edit client sends multipart requests to `/v1/images/edits`.
- [x] Base URL works with or without `/v1`.
- [x] Request timeout is configurable.
- [x] API key is read from the configured environment variable and is not printed.
- [x] Error classifier marks 429 and 5xx as retryable.
- [x] Error classifier marks 401 and 403 as stop-run errors.
- [x] Retry policy supports exponential backoff and `Retry-After`.

Verification:

- `deno test tests/openai_client_test.ts tests/error_classifier_test.ts tests/retry_policy_test.ts`

### Completed Phase 5: Runner, CLI, and Query Layer

- [x] Single job runner marks jobs running before API attempts.
- [x] Successful jobs write output, record metadata, and become `succeeded`.
- [x] Retryable failures schedule `next_attempt_at`.
- [x] Non-retryable auth failures can stop the run.
- [x] Queue runner supports configurable concurrency and minimum delay.
- [x] CLI supports `translate`, `status`, `inspect`, and `failed` flows.
- [x] Default no-subcommand behavior remains compatible with `translate`.
- [x] Query service is separate from CLI so a future Web UI can reuse it.
- [x] Resume reuses a matching running run and resets stale running jobs.

Verification:

- `deno test tests/job_runner_test.ts tests/queue_runner_test.ts tests/cli_args_test.ts tests/cli_run_test.ts tests/query_commands_test.ts tests/run_query_service_test.ts`

### Completed Follow-up: Image Option Support

- [x] Verify official/compatible `gpt-image-2` supported options for image edit requests.
- [x] Add validated options to `OpenAIConfig`: `size`, `quality`, `background`, and `outputFormat`.
- [x] Add Chinese comments and option values to `config.example.yaml`.
- [x] Document manual smoke-test behavior under `.local/smoke-test/`.
- [x] Centralize image option values in `src/openai/image-options.ts`.

Implemented behavior notes:

- `size`, `quality`, and `background` accept `auto`.
- `auto` means the field is omitted from the request payload.
- `outputFormat` is still sent as `output_format` because it controls output decoding and file
  naming.
- The known supported `size` values are fixed API canvas sizes, not arbitrary source-image ratios.
- `output.formatFromApi` now controls whether the final output path follows the API response format
  or keeps the planned extension from `openai.image.outputFormat`.

Verification:

- `deno test tests/config_test.ts tests/openai_client_test.ts`

## Next Architecture Maintenance

### Task A1: Normalize Shared Constants and Status Metadata

**Description:** Review repeated status strings, config option lists, and CLI/query display
mappings. Move constants only when doing so reduces duplication without creating a generic dumping
ground.

**Acceptance criteria:**

- Job/run status values have a single authoritative type definition.
- User-facing status summaries still match current CLI output.
- No CLI-specific formatting leaks into storage or queue modules.

**Verification:**

- `deno task check`
- `deno task test`

**Files likely touched:**

- `src/shared/types.ts`
- `src/cli/run.ts`
- `src/cli/query-commands.ts`
- `src/services/run-query.ts`

**Estimated scope:** Small

### Task A2: Tighten Query-Service Boundaries

**Description:** Audit `RunQueryService` and storage row mapping to ensure future Web UI callers can
consume stable DTOs without depending on SQLite row shapes or CLI output formatting.

**Acceptance criteria:**

- Query service returns typed records that are independent from database row names.
- CLI query commands only format query-service results.
- Storage row mappers remain internal to storage.

**Verification:**

- `deno test tests/run_query_service_test.ts tests/query_commands_test.ts`
- `deno task check`

**Files likely touched:**

- `src/services/run-query.ts`
- `src/storage/row-mappers.ts`
- `src/cli/query-commands.ts`
- `tests/run_query_service_test.ts`
- `tests/query_commands_test.ts`

**Estimated scope:** Medium

### Task A3: Document Real Smoke-Test Workflow

**Description:** Convert the ad-hoc smoke-test notes under `.local/smoke-test/` into a stable, safe
manual workflow document that does not include secrets or generated outputs.

**Acceptance criteria:**

- [x] A documented opt-in smoke command exists.
- [x] Required environment variables are listed without exposing values.
- [x] Expected success and failure signals are documented.
- [x] Generated outputs remain under ignored temporary directories.

**Verification:**

- Documentation review.
- Optional manual smoke test.

**Files likely touched:**

- `docs/smoke-tests.md`
- `.local/smoke-test/api-test-notes.md`
- `.gitignore` for temporary outputs

**Estimated scope:** Small

## Future Feature Roadmap

### Task F1: Aspect-Ratio Preprocessing Design

**Description:** Design a preprocessing stage that pads input images to the nearest supported
`gpt-image-2` canvas ratio without shrinking original pixels. This stage should run before the
OpenAI client and produce a prepared image path plus the chosen API `size`.

Target behavior:

- Read the original image dimensions.
- Select the best supported API canvas by aspect-ratio match.
- Keep the original image centered.
- Expand the canvas to the selected ratio without compressing original pixels.
- Fill expanded areas with transparent or white background based on config.
- Send the preprocessed image to `/v1/images/edits`.
- Set request `size` to the selected supported canvas size.

**Acceptance criteria:**

- Design documents where preprocessing sits in the queue/job-runner flow.
- Config shape is specified but not necessarily implemented.
- Storage implications are identified for original, preprocessed, uncropped API output, and final
  output paths.
- Image library choice is justified, preferably JSR/Deno-compatible.

**Verification:**

- `docs/spec.md` updated with the agreed design.
- `docs/tasks.md` updated if task boundaries change.

**Files likely touched:**

- `docs/spec.md`
- `docs/tasks.md`
- Possibly an ADR under `docs/adr/`

**Estimated scope:** Medium

### Task F2: Add Aspect-Ratio Preprocessing Config

**Description:** Add configuration for optional aspect-ratio preprocessing and optional crop-back
behavior.

Proposed YAML shape:

```yaml
preprocess:
  aspectPad:
    enabled: false
    fill: transparent # transparent / white
    cropBackToOriginal: false
    intermediateDir: .intermediate
```

Config behavior:

- `enabled: false` preserves current behavior.
- `fill: transparent` uses transparent padding when output format and image processing support it.
- `fill: white` uses opaque white padding.
- `cropBackToOriginal: true` crops returned API output back to the original pixel rectangle.
- `intermediateDir` is inside `outputDir` and stores pre-crop API outputs when crop-back is enabled.

**Acceptance criteria:**

- Defaults preserve current behavior.
- Config validation rejects unknown fill modes and unsafe intermediate paths.
- `config.example.yaml` documents the feature in Chinese.

**Verification:**

- `deno test tests/config_test.ts`
- `deno task check`

**Files likely touched:**

- `config.example.yaml`
- `src/config/defaults.ts`
- `src/config/load.ts`
- `src/config/schema.ts`
- `src/shared/types.ts`
- `tests/config_test.ts`

**Estimated scope:** Medium

### Task F3: Implement Aspect-Ratio Planner

**Description:** Implement pure functions that choose the best supported API canvas size and compute
padding/crop rectangles from source dimensions.

Rules:

- Do not shrink the original image pixels.
- Scale the selected API canvas ratio up to contain the original dimensions.
- Center the original image in the expanded canvas.
- Store the original image rectangle for optional crop-back after API output.

**Acceptance criteria:**

- Square, portrait, landscape, and extreme aspect-ratio inputs choose deterministic sizes.
- Computed canvas dimensions always contain the original dimensions.
- Crop rectangle corresponds to the original image position within the padded canvas.
- No filesystem or image library dependency is required for the planner tests.

**Verification:**

- `deno test tests/aspect_ratio_planner_test.ts`
- `deno task check`

**Files likely touched:**

- `src/core/aspect-ratio-planner.ts`
- `tests/aspect_ratio_planner_test.ts`

**Estimated scope:** Medium

### Task F4: Implement Image Padding and Crop Processing

**Description:** Add an image processing adapter that can create padded input images and optionally
crop API outputs back to the original rectangle.

Processing flow:

- Read original dimensions.
- Create a padded canvas using the planner result.
- Write a temporary/preprocessed input image for the API call.
- Preserve the API's uncropped output when crop-back is enabled.
- Crop the API output back to the original rectangle when configured.
- Write the final output to the normal output path.

**Acceptance criteria:**

- Original pixels are not downscaled during preprocessing.
- Padded image dimensions match the planner output.
- Fill mode supports transparent and white padding.
- Crop-back produces only a crop, not a resize.
- Uncropped API output is retained under the configured intermediate directory when crop-back is
  enabled.
- Temporary files are cleaned up when safe, while durable intermediate outputs are preserved.

**Verification:**

- Unit tests using generated small images.
- `deno task check`
- `deno task test`

**Files likely touched:**

- `src/core/image-preprocessor.ts`
- `src/fs/output-path.ts`
- `src/queue/job-runner.ts`
- `src/storage/output-store.ts`
- `tests/image_preprocessor_test.ts`
- `tests/job_runner_test.ts`

**Estimated scope:** Large

### Task F5: Integrate Preprocessing with Queue Execution

**Description:** Wire aspect-ratio preprocessing into job execution while preserving current
behavior when disabled.

**Acceptance criteria:**

- Disabled preprocessing leaves existing request and output behavior unchanged.
- Enabled preprocessing sends the padded image path to the OpenAI client.
- Enabled preprocessing sets request `size` to the planner-selected API size.
- Crop-back mode writes the final cropped output to the normal output path.
- Crop-back mode also preserves the uncropped API output in the intermediate directory.
- Attempts and output metadata clearly identify final output and any preserved intermediate output.

**Verification:**

- `deno test tests/job_runner_test.ts tests/queue_runner_test.ts`
- `deno task test`
- Optional manual smoke test on one portrait, one landscape, and one square image.

**Files likely touched:**

- `src/queue/job-runner.ts`
- `src/openai/client.ts`
- `src/shared/types.ts`
- `src/storage/output-store.ts`
- `tests/job_runner_test.ts`
- `tests/queue_runner_test.ts`

**Estimated scope:** Large

### Task F6: Expose Operational Controls for Preprocessing

**Description:** Add CLI/query visibility for preprocessing decisions so users can diagnose why a
given output used a particular canvas size or crop behavior.

**Acceptance criteria:**

- Job inspection shows whether preprocessing was enabled.
- Job inspection shows selected API size and crop-back status when available.
- Failed preprocessing errors are clear and non-retryable unless caused by transient filesystem
  issues.

**Verification:**

- `deno test tests/query_commands_test.ts tests/run_query_service_test.ts`
- Manual CLI inspection of a preprocessed run.

**Files likely touched:**

- `src/services/run-query.ts`
- `src/cli/query-commands.ts`
- `src/storage/migrations.ts`
- `tests/query_commands_test.ts`
- `tests/run_query_service_test.ts`

**Estimated scope:** Medium

### Task F7: Add Defensive Output-Format Detection Fallback

**Description:** Evaluate whether the project can integrate
[`google/magika`](https://github.com/google/magika) or an equivalent content-based format detector
as a defensive fallback when the image API response does not provide a usable `output_format`. This
is intentionally low priority because the normal path should continue to trust the API response
first, and this fallback should only run when `output_format` is missing or invalid.

Target behavior:

- Keep `output_format` from the API response as the primary source of truth.
- Only attempt fallback detection when `output_format` is absent, empty, or unsupported.
- Detect format from decoded response bytes rather than from file extension.
- Restrict accepted fallback results to the output formats the project can safely write and name.
- Preserve current behavior when detection is unavailable, inconclusive, or too costly to enable by
  default.

**Acceptance criteria:**

- The feasibility of using `Magika` from Deno on Windows is documented.
- The fallback activation rules are specified so normal successful responses do not change behavior.
- The design identifies how detected format maps to output extension and persisted output metadata.
- Failure behavior is specified for unknown or ambiguous detection results.
- If implementation proceeds, tests cover missing `output_format` with a correctly detected format.

**Verification:**

- `docs/spec.md` or a related design note records the decision.
- If implemented later: `deno test tests/response_parser_test.ts tests/job_runner_test.ts`

**Files likely touched:**

- `docs/tasks.md`
- `docs/spec.md`
- `src/openai/response-parser.ts`
- `src/queue/job-runner.ts`
- `src/fs/output-path.ts`
- `src/storage/output-store.ts`
- `tests/response_parser_test.ts`
- `tests/job_runner_test.ts`

**Estimated scope:** Medium

### Task F8: Design Multi-Key and Provider-Pool Scheduling Module

**Description:** Design a later-phase scheduling module that can manage multiple API keys and, in a
future expansion, multiple providers. This should be treated as a major-version feature rather than
an incremental patch because it affects configuration, runtime selection, retry behavior,
parallelism, observability, and failure handling.

Design goals:

- Keep the first implementation step small: support multiple API keys for one provider.
- Treat key selection as a separate scheduling concern rather than burying it inside the OpenAI
  client.
- Allow future expansion from a single-provider key pool to a multi-provider account pool.
- Persist enough runtime state to understand which key/provider handled which job.
- Avoid leaking secrets in logs, query output, or persisted diagnostic metadata.

**Acceptance criteria:**

- The design defines a dedicated scheduler/module boundary for account/key selection.
- The design breaks implementation into small stages with backward-compatible entry points.
- Config shape is proposed for single-provider multi-key support and future multi-provider support.
- Scheduling strategy tradeoffs are documented before implementation starts.

**Verification:**

- `docs/spec.md` updated with the agreed architecture.
- `docs/tasks.md` updated if stage boundaries change.

**Files likely touched:**

- `docs/spec.md`
- `docs/tasks.md`
- Possibly an ADR under `docs/adr/`

**Estimated scope:** Large

### Task F9: Add Single-Provider Multi-Key Rotation

**Description:** Add the first minimal version of multi-key support for one provider. The initial
goal is to let one configured provider hold multiple API keys and rotate between them for requests.

Initial target behavior:

- Support multiple API keys for the same provider in config.
- Default to simple round-robin or stable rotation across available keys.
- Keep single-key config working without migration pressure.
- Record which logical key handled each attempt, using masked or non-secret identifiers only.

**Acceptance criteria:**

- A provider can be configured with more than one API key.
- Request execution can select the next usable key without changing existing single-key behavior.
- Attempt metadata can show which key slot or key label was used without storing raw secrets.
- Unit tests cover deterministic rotation behavior.

**Verification:**

- `deno test tests/openai_client_test.ts tests/job_runner_test.ts tests/storage_test.ts`
- `deno task check`

**Files likely touched:**

- `src/shared/types.ts`
- `src/config/schema.ts`
- `src/openai/client.ts`
- `src/queue/job-runner.ts`
- `src/storage/migrations.ts`
- `tests/openai_client_test.ts`
- `tests/job_runner_test.ts`
- `tests/storage_test.ts`

**Estimated scope:** Medium

### Task F10: Add Key Failover and Usage-Balancing Strategies

**Description:** Expand single-provider multi-key support with selectable scheduling strategies.
Expected early strategies are:

- Prefer one key until it fails, then switch to the next available key.
- Distribute traffic as evenly as possible across all healthy keys.

Behavior notes:

- Retryable and non-retryable failures may need different key-health effects.
- Temporary rate-limit failures should not immediately mark a key permanently unusable.
- Strategy selection should be explicit in config rather than hidden in heuristics.

**Acceptance criteria:**

- At least two strategies are supported: primary-with-failover and balanced rotation.
- Key-health state is tracked well enough to avoid obviously bad repeated selection.
- Scheduler behavior remains deterministic enough for tests.
- CLI/query inspection can show enough metadata to diagnose why a key was chosen or skipped.

**Verification:**

- `deno test tests/job_runner_test.ts tests/queue_runner_test.ts tests/query_commands_test.ts`
- `deno task check`

**Files likely touched:**

- `src/queue/`
- `src/services/run-query.ts`
- `src/cli/query-commands.ts`
- `src/storage/`
- `tests/job_runner_test.ts`
- `tests/queue_runner_test.ts`
- `tests/query_commands_test.ts`

**Estimated scope:** Large

### Task F11: Enable Concurrency Scheduling by Key Capacity

**Description:** Allow runtime parallelism to scale with available healthy keys so the queue can
make safe concurrent requests without overloading a single key.

Target behavior:

- Concurrency can be capped globally and additionally constrained by key availability.
- A single healthy key may still force effectively serialized execution.
- Multiple healthy keys can unlock controlled parallelism.
- Scheduling should avoid giving multiple simultaneous jobs to a key that is currently cooling down
  from rate limits when alternatives exist.

**Acceptance criteria:**

- The scheduler can limit active jobs based on key availability.
- Parallel execution remains compatible with retry and resume behavior.
- Rate-limited keys can temporarily reduce usable scheduling capacity.
- Tests cover one-key and multi-key concurrency behavior.

**Verification:**

- `deno test tests/queue_runner_test.ts tests/job_runner_test.ts`
- `deno task test`

**Files likely touched:**

- `src/queue/queue-runner.ts`
- `src/queue/job-runner.ts`
- `src/openai/`
- `tests/queue_runner_test.ts`
- `tests/job_runner_test.ts`

**Estimated scope:** Large

### Task F12: Expand to Multi-Provider Account Pools

**Description:** Generalize the key scheduler into a provider/account pool that can manage multiple
providers, multiple API keys per provider, per-provider capability differences, and ongoing health
tracking for intelligent request routing.

Longer-term target behavior:

- Support multiple providers in one config.
- Support multiple API keys under each provider.
- Track provider/key health and recent failures.
- Route jobs to an appropriate provider/key based on health, capability, and scheduling policy.
- Keep provider-specific request differences out of high-level queue code as much as possible.

**Acceptance criteria:**

- Config can describe a provider pool without breaking the simple single-provider path.
- Health tracking distinguishes provider-level failures from key-level failures.
- The scheduling module can choose among providers and keys using explicit policy.
- Query/inspection output can explain which provider/key handled each attempt.

**Verification:**

- `docs/spec.md` updated with provider-pool design.
- `deno task check`
- `deno task test`

**Files likely touched:**

- `src/config/`
- `src/openai/` or a future `src/providers/`
- `src/queue/`
- `src/services/run-query.ts`
- `src/storage/`
- `tests/`
- `docs/spec.md`

**Estimated scope:** Very Large

### Task F13: Design Local Logging Module and Config

**Description:** Design a dedicated local logging module for CLI diagnostics. This should be treated
as a standalone module rather than relying on `@std/log`, because Deno marks `@std/log` as no longer
recommended and likely removable in the future.

Design goals:

- Keep user-facing progress output separate from diagnostic log persistence.
- Support explicit log levels without forcing verbose output by default.
- Support optional file logging to a configurable directory.
- Preserve current behavior when logging is disabled.

Proposed YAML shape:

```yaml
logging:
  enabled: false
  level: info # debug / info / warn / error
  dir: ./logs
```

**Acceptance criteria:**

- Logging config shape is specified in spec and task docs.
- The module boundary is defined so queue/core code can emit logs without owning CLI formatting.
- The design explicitly rejects `@std/log` as the new default foundation.
- Secret-handling rules for logs are documented.

**Verification:**

- `docs/spec.md` updated with agreed logging direction.
- `docs/tasks.md` updated if logging scope changes.

**Files likely touched:**

- `docs/spec.md`
- `docs/tasks.md`
- Possibly an ADR under `docs/adr/`

**Estimated scope:** Medium

### Task F14: Add Logging Config Validation and Defaults

**Description:** Extend configuration types, defaults, and validation to support an opt-in logging
section.

Target behavior:

- Logging is disabled by default.
- Default log directory is `./logs`.
- Supported levels are constrained to a small explicit set.
- Invalid or unsafe logging configuration is rejected early.

**Acceptance criteria:**

- Config types include a logging section.
- Defaults preserve current non-logging behavior.
- Validation rejects unknown levels and empty log directory values.
- `config.example.yaml` documents the feature in Chinese.

**Verification:**

- `deno test tests/config_test.ts`
- `deno task check`

**Files likely touched:**

- `src/shared/types.ts`
- `src/config/defaults.ts`
- `src/config/load.ts`
- `src/config/schema.ts`
- `config.example.yaml`
- `tests/config_test.ts`

**Estimated scope:** Small

### Task F15: Implement Lightweight Logger Module

**Description:** Build a small internal logger module with level filtering and optional file output.

Initial target behavior:

- Support `debug`, `info`, `warn`, and `error` levels.
- Support a no-op logger when disabled.
- Support console logging and optional file logging through a stable interface.
- Create the log directory lazily when file logging is enabled.

**Acceptance criteria:**

- The logger module has a narrow, reusable interface.
- Disabled logging avoids creating files or directories.
- File logging works on Windows and writes deterministic text output.
- Logger tests cover level filtering and disabled behavior.

**Verification:**

- `deno test tests/logger_test.ts`
- `deno task check`

**Files likely touched:**

- `src/logging/`
- `tests/logger_test.ts`

**Estimated scope:** Medium

### Task F16: Integrate Diagnostic Logging into CLI Execution

**Description:** Wire the logger module into CLI execution, queue execution, and key operational
events while preserving readable user-facing progress output.

Target behavior:

- Existing progress output remains available to the user.
- Diagnostic logs can additionally record run start/end, job start/end, retries, and failures.
- Logging can be turned on without changing core execution outcomes.
- Logging level controls which diagnostic records are persisted.

**Acceptance criteria:**

- CLI execution can create and pass a logger instance through the runtime flow.
- Logging remains optional and does not break existing tests when disabled.
- Run/job lifecycle events emit diagnostic logs through the new module.
- Secret values are not included in emitted log lines.

**Verification:**

- `deno test tests/cli_run_test.ts tests/job_runner_test.ts tests/queue_runner_test.ts`
- `deno task test`

**Files likely touched:**

- `src/main.ts`
- `src/cli/run.ts`
- `src/queue/`
- `src/openai/`
- `tests/cli_run_test.ts`
- `tests/job_runner_test.ts`
- `tests/queue_runner_test.ts`

**Estimated scope:** Medium

### Task F17: Define Log File Strategy and Operational Behavior

**Description:** Decide how log files should be organized for real usage and whether they should be
per-run, shared, or rotated.

Questions this task should settle:

- Should logs be written to one file per run, one shared file, or a simple rolling scheme?
- Should dry-run logging create files when enabled?
- Should query commands eventually expose log file locations or recent logging metadata?

**Acceptance criteria:**

- File naming and retention behavior are documented.
- Operational tradeoffs are documented for Windows/local CLI usage.
- The decision does not require immediate implementation of complex rotation.

**Verification:**

- Documentation review.

**Files likely touched:**

- `docs/spec.md`
- `docs/tasks.md`
- Possibly `docs/adr/`

**Estimated scope:** Small

## Open Planning Questions

- Should `gpt-image-2-2k` and `gpt-image-2-4k` be exposed as model presets or remain plain model
  strings?
- Which image processing library should be used for padding/cropping on Deno and Windows?
- Should transparent padding automatically force `outputFormat: png` or only validate/warn?
- Should intermediate preprocessed API inputs be preserved, or only uncropped API outputs?
- Should crop-back metadata be stored in the existing `outputs` table or a new processing-metadata
  table?
- If `output_format` is missing, should fallback detection silently infer the extension, warn in
  logs/query output, or require opt-in configuration?
- Should multi-key scheduling metadata live in attempts, a separate account-health table, or both?
- For multi-provider support, should provider failover be automatic or require explicit routing
  policy?
- Should key balancing be purely round-robin, weighted, cooldown-aware, or usage-quota-aware?
- Should local file logging default to one log file per run, a shared append-only file, or a simple
  rolling strategy?
- Should dry-run mode write diagnostic log files when logging is enabled, or only emit in-memory /
  console diagnostics?
- Should prompt support per-directory or per-file overrides later?
- Are cancellation and pause controls needed in the first CLI release or only for the future Web UI?

## Risks and Mitigations

| Risk                                                   | Impact | Mitigation                                                     |
| ------------------------------------------------------ | ------ | -------------------------------------------------------------- |
| Image requests take several minutes                    | High   | Long timeout, durable queue, resume support                    |
| API key leaks in logs                                  | High   | Read from env and mask secret values                           |
| 429 or transient failures interrupt batches            | High   | Retry policy with `Retry-After` and SQLite attempts            |
| Output extension mismatch                              | Medium | Use `output_format` from response                              |
| Logging writes secrets or noisy internal details       | High   | Separate progress from diagnostics and redact sensitive values |
| Future Web UI needs different control flow             | Medium | Keep queue/core independent from CLI                           |
| Fixed API canvas sizes crop or alter unusual ratios    | Medium | Optional aspect-ratio preprocessing and crop-back workflow     |
| Cropped output hides useful uncropped API result       | Medium | Preserve uncropped API output in an intermediate output folder |
| Image processing dependencies behave poorly on Windows | Medium | Choose a Deno/Windows-compatible library and test early        |
