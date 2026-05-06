# Smoke Test 说明文档

本仓库将真实 API 的 smoke test 资料和示例配置保存在 `.local/smoke-test/`。这些文件仅供本地使用，不应提交。

## 目的

smoke test 用于验证 CLI 是否能够：

- 发起一次真实图像编辑请求
- 写出翻译后的输出文件
- 持久化批次与图片任务状态

## 所需环境

- `OPENAI_API_KEY`：当前配置所需的 API key
- 能访问配置中 `baseUrl` 的网络环境

## 推荐命令

请在仓库根目录执行。示例配置使用仓库相对路径。

```bash
deno task translate --config ./.local/smoke-test/smoke-cli-config.yaml
```

如需做受控样本执行，也可以限制本次新成功图片任务数量：

```bash
deno task translate --config ./.local/smoke-test/smoke-cli-config.yaml --max-success 3
```

## 预期输入

- `.local/smoke-test/037.jpg` 或 `.local/smoke-test/` 下的其他测试图片
- `.local/smoke-test/smoke-cli-config.yaml`

## 预期输出

- 翻译后的图片文件：`.local/smoke-test/cli-smoke-output/`
- SQLite 状态文件：`.local/smoke-test/cli-smoke-state/translator.db`
- 控制台输出批次 id 与图片任务统计摘要

## 预期行为

- 请求路径使用 `/v1/images/edits`
- 响应为 JSON
- CLI 解码 `data[0].b64_json` 并写出输出图片
- 当 `output.formatFromApi: true` 时，输出扩展名跟随响应 `output_format`
- 当 `output.formatFromApi: false` 时，输出扩展名跟随配置中的 `openai.image.outputFormat`
- 当已加载配置对应的 `run hash` 一致、上一批次仍处于 `running`、且 `queue.resume` 为
  `true` 时，批次可以自动续跑，并将当前扫描结果合并到原批次中
- 当使用 `--max-success <n>` 时，CLI 会在当前 invocation 中成功完成 `n` 个新图片任务后停止继续调度，等待已在执行中的任务结束，并保持批次可续跑

## 失败信号

- `401` 或 `403`：凭据或权限无效，批次应直接停止
- `429` 或 `5xx`：请求应按重试配置继续重试
- 配置校验错误：应在发起 API 请求前直接失败

## 清理

不再需要时，可删除以下目录：

```text
.local/smoke-test/cli-smoke-output/
.local/smoke-test/cli-smoke-state/
```

如果本地 API 说明仍对人工验证有帮助，可以保留 `.local/smoke-test/api-test-notes.md`。
