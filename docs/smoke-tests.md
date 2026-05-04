# Smoke Tests

This repository keeps real API smoke-test notes and sample configs under `.local/smoke-test/`. Those
files are local-only and should not be committed.

## Purpose

Use smoke tests to verify that the CLI can send a real image edit request, write the translated
output, and persist job state.

## Required Environment

- `OPENAI_API_KEY`: API key for the configured OpenAI-compatible service.
- Network access to the configured `baseUrl`.

## Recommended Smoke Command

Run this command from the repository root. The sample config uses repository-relative paths.

```bash
deno task translate --config ./.local/smoke-test/smoke-cli-config.yaml
```

For a controlled sample run, you can also stop after a small number of new successes:

```bash
deno task translate --config ./.local/smoke-test/smoke-cli-config.yaml --max-success 3
```

## Expected Inputs

- `.local/smoke-test/037.jpg` or another test image in `.local/smoke-test/`
- `.local/smoke-test/smoke-cli-config.yaml`

## Expected Outputs

- Translated image files under `.local/smoke-test/cli-smoke-output/`
- SQLite state under `.local/smoke-test/cli-smoke-state/translator.db`
- Console summary with run id and job counts

## Expected Behavior

- The request uses `/v1/images/edits`.
- The response is JSON.
- The CLI decodes `data[0].b64_json` and writes the output image.
- With `output.formatFromApi: true`, the output file extension follows response `output_format`.
- With `output.formatFromApi: false`, the output file extension follows configured
  `openai.image.outputFormat`.
- The run can be resumed if the same loaded config hash is used, the previous run is still
  `running`, and `queue.resume` is enabled. Current input scan results are merged into the existing
  run.
- With `--max-success <n>`, the CLI stops scheduling new jobs after `n` newly succeeded images in the
  current invocation, waits for any in-flight jobs to finish, and leaves the run resumable if work
  remains.

## Failure Signals

- `401` or `403`: credentials or permissions are invalid and the run should stop.
- `429` or `5xx`: request should be retried according to retry settings.
- Config validation errors should fail before the API request is sent.

## Cleanup

Remove the smoke output directory and state database when you no longer need them:

```text
.local/smoke-test/cli-smoke-output/
.local/smoke-test/cli-smoke-state/
```

Keep the local API notes in `.local/smoke-test/api-test-notes.md` if they are still useful for
manual verification.
