# GPT Image Translator

一个基于 Deno 的命令行工具，用于批量翻译目录中的图片。程序会递归扫描输入目录，将图片发送到 OpenAI-compatible `/v1/images/edits` 接口，并按原目录结构写入输出目录。

## 功能

- 批量扫描 `.jpg`、`.jpeg`、`.png`、`.webp` 图片
- 保留输入目录的相对目录结构
- 支持 YAML 配置文件
- 支持 OpenAI-compatible 图片编辑接口
- 使用 SQLite 保存 runs / jobs / attempts / outputs
- 支持断点续跑、重试和失败查询
- 支持 `status`、`inspect`、`failed` 查询命令
- 支持配置文件版本升级
- 支持可选诊断日志
- 支持可选长宽比补边预处理和裁剪回原图区域

## 环境要求

- Deno 2.x
- 可访问的 OpenAI-compatible 图片编辑 API
- API key，可以通过环境变量或配置文件提供

## 快速开始

复制示例配置：

```bash
cp config.example.yaml config.yaml
```

编辑 `config.yaml`，至少确认以下字段：

```yaml
inputDir: ./input
outputDir: ./output

openai:
  baseUrl: https://api.openai.com/v1
  apiKeyEnv: OPENAI_API_KEY
  model: gpt-image-2

prompt: |
  Translate all text in the image to Simplified Chinese while preserving
  the original layout, visual composition, typography style, and image content.
```

设置环境变量：

```bash
export OPENAI_API_KEY=your_api_key
```

也可以直接在本地私有配置中写入：

```yaml
openai:
  apiKey: your_api_key
```

`config.yaml` 已被 `.gitignore` 忽略，避免误提交本地密钥。

## 使用

试运行，只扫描和规划，不请求 API：

```bash
gpt-image-translator --config ./config.yaml --dry-run
```

执行翻译：

```bash
gpt-image-translator --config ./config.yaml
```

查看最近 runs：

```bash
gpt-image-translator status --config ./config.yaml --limit 10
```

查看指定 run 详情：

```bash
gpt-image-translator inspect --config ./config.yaml --run <runId>
```

查看失败 jobs：

```bash
gpt-image-translator failed --config ./config.yaml --run <runId>
```

升级旧配置文件：

```bash
gpt-image-translator config upgrade --config ./config.yaml --dry-run
gpt-image-translator config upgrade --config ./config.yaml
```

## 配置升级

默认升级模式会尽量保留注释和原格式，只追加缺失的顶层配置块。完整重写配置需要显式使用：

```bash
gpt-image-translator config upgrade --config ./config.yaml --full-update --allow-drop-comments
```

完整重写可能丢失注释和原有排版。

## 日志

诊断日志默认关闭，不影响命令行进度输出。可以在配置中开启：

```yaml
logging:
  enabled: true
  level: info
  dir: ./logs
  console: false
  file: true
```

日志文件会按 run id 写入配置的日志目录。

## 断点续跑

默认配置中 `queue.resume: true`。执行 `translate` 时，程序会查找同一有效配置下最近一个
`running` 状态的 run，并在找到时继续该 run。

当前自动续跑规则：

- 使用加载后的完整配置内容计算匹配 hash；配置文件路径本身不参与匹配。
- 只有状态仍为 `running` 的 run 会被自动续跑。
- 续跑时，遗留的 `running` jobs 会被重置为 `retryable`，错误类型记为 `interrupted`。
- 程序会重新扫描输入目录，并把当前扫描结果合并到这个 run。
- 新增输入文件会加入当前 run；已经不存在的旧输入文件暂时不会自动取消。
- 如果 `output.skipExisting` 生效，已有输出文件可能让未完成 job 转为 `skipped`。

注意：当前版本仍用完整配置 hash 匹配，因此更换 API key 或 provider 配置可能导致无法自动
续跑。后续计划会引入独立的任务指纹，让 provider/API key 变化不再影响同一翻译任务的续跑。

## 长宽比预处理

`gpt-image-2` 只支持固定画布尺寸。遇到非标准长宽比图片时，可以启用补边预处理，让程序先把原图居中放到最接近的支持比例画布中，再发送给接口：

```yaml
preprocess:
  aspectPad:
    enabled: true
    fill: transparent
    cropBackToOriginal: true
    intermediateDir: .intermediate
```

启用后，程序会自动选择 `1024x1024`、`1024x1536` 或 `1536x1024` 作为请求 `size`。`cropBackToOriginal: true` 时，最终输出会裁剪回原图区域，未裁剪的接口输出会保留在 `outputDir/intermediateDir` 下，方便排查模型返回效果。

默认配置中该功能关闭，保持原图直接提交给接口。

## 开发

格式化：

```bash
deno task fmt
```

类型检查：

```bash
deno task check
```

运行测试：

```bash
deno task test
```

## 许可证

MIT
