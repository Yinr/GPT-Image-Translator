# GPT Image Translator

一个基于 Deno
的命令行工具，用于批量翻译目录中的图片。程序会递归扫描输入目录，为每张图片创建一个持久化图片任务（job），将图片发送到
OpenAI-compatible `/v1/images/edits` 接口，并按原目录结构写入输出目录。

## 特性

- 批量扫描 `.jpg`、`.jpeg`、`.png`、`.webp` 图片
- 保留输入目录的相对目录结构
- 支持 YAML 配置文件
- 支持 OpenAI-compatible 图片编辑接口
- 使用 SQLite 保存批次（runs）/ 图片任务（jobs）/ 尝试（attempts）/ 输出（outputs）
- 支持断点续跑、重试和失败查询
- 支持 `status`、`inspect`、`failed` 查询命令
- 支持按“本次新增成功张数”设置执行上限
- 支持配置文件版本升级
- 支持可选诊断日志
- 支持可选长宽比补边预处理和裁剪回原图区域

## 适用场景

- 批量翻译漫画、截图、海报等目录型图片素材
- 长时间运行、可能被中断、需要续跑的图像翻译批次
- 需要保留批次、图片任务、尝试记录与失败信息的本地 CLI 工作流

## 环境要求

- Deno 2.x
- 可访问的 OpenAI-compatible 图片编辑 API
- API key（API 凭据），可以通过环境变量或配置文件提供

## 版本

查看当前程序版本：

```bash
gpt-image-translator --version
gpt-image-translator version
```

更新程序版本号：

```bash
# 0.1.0 -> 0.1.1
deno task version:patch

# 0.1.0 -> 0.2.0
deno task version:minor

# 0.1.0 -> 1.0.0
deno task version:major
```

推荐的发布流程：

```bash
# 1. 更新版本号
deno task version:patch

# 2. 校验
deno task check
deno task test

# 3. 编译需要的平台
deno task compile:win

# 4. 提交并打 tag
git commit -am "release: prepare v0.1.1"
git tag v0.1.1
```

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

最常用命令：

```bash
# 试运行：只扫描和规划，不请求 API
gpt-image-translator --config ./config.yaml --dry-run

# 执行翻译
gpt-image-translator --config ./config.yaml

# 只做小批量验证
gpt-image-translator --config ./config.yaml --max-success 5
```

## 使用

试运行，只扫描和规划，不请求 API：

```bash
gpt-image-translator --config ./config.yaml --dry-run
```

执行翻译：

```bash
gpt-image-translator --config ./config.yaml
```

只跑一个小批次，成功翻译 5 张新图片后停止继续调度：

```bash
gpt-image-translator --config ./config.yaml --max-success 5
```

查看最近批次（runs）：

```bash
gpt-image-translator status --config ./config.yaml --limit 10
```

查看指定批次（run）详情：

```bash
gpt-image-translator inspect --config ./config.yaml --run <runId>
```

查看失败图片任务（jobs）：

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

日志文件会按 `run id`
写入配置的日志目录，适合记录批次开始/结束、图片任务开始/完成/失败，以及重试、冷却、错误分类等诊断信息。

## 断点续跑

默认配置中 `queue.resume: true`。执行 `translate` 时，程序会查找同一已加载配置（loaded
config）下最近一个 `running` 状态的批次（run），并在找到时继续该 run。

当前自动续跑（resume）规则：

- 使用已加载配置（loaded config）内容计算配置哈希（config hash）；配置文件路径本身不参与匹配。
- 只有状态仍为 `running` 的批次（run）会被自动续跑。
- 续跑时，遗留的 `running` 图片任务（jobs）会被重置为 `retryable`，错误类型记为 `interrupted`。
- 程序会重新扫描输入目录，并把当前扫描结果合并到这个 run。
- 新增输入文件会加入当前 run；已经不存在的旧输入文件暂时不会自动取消。
- 如果 `output.skipExisting` 生效，已有输出文件可能让未完成 job 转为 `skipped`。

注意：当前版本仍用完整配置哈希（config hash）匹配，因此更换 API key、API
供应商或适配器相关配置可能导致无法自动续跑。后续计划会梳理 config hash
纳入字段，并引入独立的任务指纹。

## 执行上限

`translate` 支持
`--max-success <n>`，用于在本次批次执行中成功完成指定数量的新图片任务后停止继续调度。

- 只统计本次 invocation 新成功的图片任务（jobs）。
- 不计入之前 run 中已经成功的 jobs。
- 不计入 `skipped` jobs。
- 达到上限后，不再启动新的 job。
- 如果有并发中的 job，程序会等待它们完成，再以可续跑状态结束当前 run。

这适合小批量验证、额度紧张时的受控执行，或者先抽样检查 prompt 和接口接入效果。

## 长宽比预处理

`gpt-image-2`
只支持固定画布尺寸。遇到非标准长宽比图片时，可以启用补边预处理，让程序先把原图居中放到最接近的支持比例画布中，再发送给接口：

```yaml
preprocess:
  aspectPad:
    enabled: true
    fill: transparent
    cropBackToOriginal: true
    intermediateDir: .intermediate
```

启用后，程序会自动选择 `1024x1024`、`1024x1536` 或 `1536x1024` 作为请求
`size`。`cropBackToOriginal: true` 时，最终输出会裁剪回原图区域，未裁剪的接口输出会保留在
`outputDir/intermediateDir` 下，方便排查模型返回效果。

默认配置中该功能关闭，保持原图直接提交给接口。

## 术语

- `run`（批次）：一次实际的批处理执行实例
- `job`（图片任务）：批次内针对单张输入图片创建的最小持久化执行单元
- `attempt`（尝试）：某个图片任务的一次具体执行尝试
- `adapter`（适配器）：本地代码中的 API 接口接入实现

完整术语与生命周期图示见 `docs/terminology.md`。

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
