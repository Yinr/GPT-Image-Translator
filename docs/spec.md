# 规格说明：GPT Image Translator

## 目标

构建一个基于 Deno 的命令行程序，用于批量翻译目录中的图片。程序会将每张图片发送到
OpenAI-compatible 的 `gpt-image-2` 图像编辑接口，并使用配置中的 prompt 进行处理。

系统必须满足以下要求：

- 保留输入目录在输出目录中的相对结构
- 支持 YAML 配置
- 使用 SQLite 持久化批次与图片任务状态
- 对瞬时失败进行重试
- 支持续跑中断后的未完成批次

当前主要使用者是本地运行批量翻译任务的操作者。设计上应保持核心执行逻辑独立于 CLI，
以便未来 Web UI 直接复用队列、存储和 API 接入层。

## 已确认的 API 行为

`.local/smoke-test/api-info.md` 中记录的 API 服务已经过手工验证。相关临时脚本与说明保留在
`.local/smoke-test/` 下，不应纳入版本控制。

- `GET /v1/models` 可用，并返回 `gpt-image-2`、`gpt-image-2-2k`、`gpt-image-2-4k`
- `POST /v1/images/edits` 可处理 `.local/smoke-test/037.jpg`
- 图像编辑响应是 JSON，而不是原始图片字节流
- 输出图片字节以 `data[0].b64_json` 的 base64 字段返回
- 输出扩展名应优先来自顶层 `output_format`，已观察到值为 `png`
- `output.formatFromApi` 控制最终输出路径是跟随响应 `output_format`，还是保留配置中的
  `openai.image.outputFormat`
- 一次真实图像编辑请求大约耗时 205 秒，因此需要较长超时和持久化状态

## API 接入说明

- provider 层用于描述 API 账号归属、凭据、额度、路由、代理和健康度等运营层概念。
- adapter 层用于描述请求路径、请求/响应字段差异、兼容逻辑和解析细节。
- `docs/providers/pic2api.md` 记录了 `pic2api` adapter 的差异行为，尤其是
  `size:auto` 回退到 `1:1` 以及推荐尺寸档位。
- adapter 特有的请求逻辑应位于 `src/adapters/`；共享解析、重试和错误分类可以保留在
  `src/openai/`，前提是这些逻辑不依赖某个具体 adapter。
- 当前配置继续沿用历史上的 `openai` 顶层块名称，而 `openai.adapter` 用于选择 adapter。

## 技术栈

- 运行时：Deno
- 语言：TypeScript
- 配置文件：YAML
- 持久化状态：SQLite
- API：OpenAI-compatible `/v1/images/edits`
- 测试：Deno test runner

优先库选择：

- 优先使用 Deno Standard Library：`@std/path`、`@std/fs`、`@std/cli`、`@std/yaml`、
  `@std/encoding`
- 依赖优先选择 JSR 源；仅在没有合适 JSR 方案或存在明确兼容性问题时使用 npm 或 URL import
- SQLite 优先使用 `jsr:@db/sqlite`
- 避免自行实现目录遍历、路径处理、CLI 解析、YAML 解析和 base64 解码等通用基础能力

## 命令

计划命令：

```bash
deno task check
deno task test
deno task fmt
deno task translate --config ./config.example.yaml
```

直接运行：

```bash
deno run -A src/main.ts --config ./config.example.yaml
```

支持使用 CLI 级成功上限做受控执行：

```bash
deno run -A src/main.ts --config ./config.example.yaml --max-success 5
```

## 项目结构

```text
src/
  main.ts                 程序入口
  cli/                    CLI 参数、命令执行、终端输出
  config/                 YAML 加载、默认值、校验、合并逻辑
  adapters/               图像 adapter 接口、工厂、共享基类与具体 adapter
  core/                   高层流程、扫描、路径映射、事件
  queue/                  持久化队列、调度器、执行器、并发控制
  openai/                 共享的 OpenAI-compatible 解析、错误分类与重试辅助逻辑
  storage/                SQLite 数据库、迁移、store
  fs/                     文件写入、路径辅助、MIME 辅助
  shared/                 共享类型、时间工具、结果工具
tests/                    单元与集成测试
docs/                     规格、术语与任务文档
.local/smoke-test/        本地 smoke test 资料，忽略提交
```

## 代码风格

- 模块保持小而清晰，输入输出类型明确
- CLI 相关逻辑不进入核心执行层
- 已固定术语、命名规则和生命周期图见 `docs/terminology.md`

## 配置

配置优先级：

```text
defaults < YAML config < CLI flags
```

术语与生命周期图示见 `docs/terminology.md`。

代表性 YAML：

```yaml
configVersion: 2

inputDir: ./input
outputDir: ./output

openai:
  baseUrl: http://127.0.0.1:3000/v1
  adapter: openai
  # 可选：在本地私有配置文件中直接填写 key
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

preprocess:
  aspectPad:
    enabled: false
    fill: transparent
    cropBackToOriginal: false
    intermediateDir: .intermediate

logging:
  enabled: false
  level: info
  dir: ./logs
```

配置说明：

- 顶层 `openai` 块当前表示 OpenAI-compatible 请求设置
- `openai.adapter` 用于选择 adapter 实现
- 当前支持的 adapter 值为 `openai`、`gpt2api`、`pic2api`
- provider 级建模应在后续单独引入，而不是直接复用 adapter 选择语义

日志配置说明：

- `logging.enabled: false` 是默认值，应保持当前无日志副作用行为
- 当前日志功能聚焦于本地 CLI 诊断，不扩展为分布式遥测
- 用户可见进度输出与诊断日志持久化属于相关但分离的两层
- 不应把 `@std/log` 作为新的日志基础

配置升级说明：

- 缺失 `configVersion` 视为版本 `0`
- `config upgrade` 在写入前必须先校验现有配置
- 默认升级模式通过版本化文本迁移尽量保留原注释与结构
- `0 -> 1` 插入 `configVersion` 并补齐如 `logging` 等新增顶层块
- `1 -> 2` 更新版本号并补齐 `preprocess.aspectPad`
- `--full-update` 可重写为最新完整结构，但可能丢失原有注释与排版
- 当文件包含注释时，`--full-update` 必须搭配 `--allow-drop-comments`
- 正常运行只允许提示配置过旧，不允许自动改写配置文件

## 队列模型

每张输入图片会生成一个持久化图片任务。

图片任务状态：

- `pending`：已发现，等待执行
- `running`：执行中
- `retryable`：发生瞬时失败，等待 `next_attempt_at`
- `succeeded`：成功写出输出
- `failed`：永久失败
- `skipped`：被显式跳过
- `cancelled`：执行前取消

执行流程：

```text
扫描输入目录
  -> 计算输入到输出的路径映射
  -> 将图片任务写入或更新到 SQLite
  -> 调度 pending 和到期的 retryable 任务
  -> 按配置的并发和间隔执行
  -> 调用 /v1/images/edits
  -> 解码 data[0].b64_json
  -> 按 output.formatFromApi 选择最终输出路径
  -> 写入输出字节
  -> 持久化状态、尝试记录和元数据
```

成功上限行为：

- `translate --max-success <n>` 是 CLI 级执行控制，不属于 YAML 配置项
- 只统计当前 invocation 中新变为 `succeeded` 的图片任务
- 之前 invocation 中已成功的图片任务不消耗本次上限
- `skipped` 不消耗上限
- 启动新任务前必须满足 `当前 invocation 成功数 + in-flight 数 < maxSuccess`
- 达到上限后，不再启动新任务，但允许当前 in-flight 任务完成，并保持批次可续跑

## 长宽比预处理设计

`gpt-image-2` 图像编辑请求只支持固定画布尺寸：`1024x1024`、`1024x1536`、`1536x1024`。
非标准比例图片可能被模型裁切或改变构图，因此可选的预处理能力应先将原图补边到最接近的支持比例，再发起 API 请求，同时保持原始像素不缩小。

该功能默认关闭。关闭时，原图路径直接送入 API，并沿用现有 `openai.image.size` 逻辑。

配置形态：

```yaml
preprocess:
  aspectPad:
    enabled: false
    fill: transparent # transparent / white
    cropBackToOriginal: false
    intermediateDir: .intermediate
```

启用后的预处理流程：

```text
图片任务输入图片
  -> 读取原图尺寸
  -> 选择最接近的支持画布比例
  -> 计算不缩小原图像素的补边画布尺寸
  -> 将原图居中绘制到补边画布
  -> 将补边后的临时输入发送到 /v1/images/edits
  -> 请求中使用所选 API 画布尺寸
  -> 解码 API 输出
  -> 可选保留未裁剪输出到 outputDir/intermediateDir
  -> 可选按原图区域裁剪回去
  -> 将结果写入正常输出路径
```

模块边界：

- 纯比例规划器位于 `src/core`，因为它是独立于 adapter 的几何决策
- 图像处理 adapter 负责读尺寸、补边、临时文件和 crop-back
- queue 层只通过小接口调用图像处理能力，不直接操作像素
- adapter/client 只接收准备好的输入路径与请求 `size`，不负责补边和裁剪策略

规划规则：

- 支持比例来自 `1024x1024`、`1024x1536`、`1536x1024`
- 选择与源图比例绝对差最小的支持比例
- 比例相同时，按更少补边面积，再按稳定顺序
  `1024x1024`、`1024x1536`、`1536x1024` 决定
- 画布尺寸只放大不缩小，且必须完整包含原图
- 原图在补边画布中居中，记录精确 source rect 供 crop-back 使用

填充规则：

- `transparent` 使用透明补边，前提是临时格式支持 alpha
- `white` 使用纯白补边
- 如果选定临时格式无法保留透明度，必须改用支持 alpha 的无损格式，或明确报错

裁剪规则：

- `cropBackToOriginal: false` 时，未裁剪 API 输出即为最终输出
- `cropBackToOriginal: true` 时，未裁剪输出写入
  `outputDir/intermediateDir/<job-relative-output>`，最终输出写入正常路径
- crop-back 只允许裁剪，不允许缩放
- 如果 API 返回尺寸与请求尺寸不同，crop rect 需按比例映射并稳定取整

存储与查询要求：

- `outputs` 表继续表示最终输出
- 预处理相关信息应持久化，便于 `inspect` 和未来 Web UI 解释所选尺寸、画布、fill、crop-back 和未裁剪输出位置
- 预处理错误应写入 attempt 失败信息；非法图像处理错误为不可重试，瞬时文件系统错误可视情况归为可重试

图像库要求：

- 依赖必须验证 Windows 兼容性、格式支持、alpha 处理和是否依赖原生二进制
- 优先 JSR 或 Deno 原生方案
- 具体依赖与取舍记录在 `docs/tasks.md` 或 ADR 中

## 错误处理

可重试失败：

- 网络错误
- 请求超时
- HTTP 408
- HTTP 409
- HTTP 425
- HTTP 429
- HTTP 500
- HTTP 502
- HTTP 503
- HTTP 504

不可重试失败：

- HTTP 400
- HTTP 401
- HTTP 403
- HTTP 404
- HTTP 422
- 非法配置
- 不支持的文件类型
- 输入文件缺失
- 成功响应中缺失 `data[0].b64_json`

特殊规则：

- `401` 与 `403` 应立即停止整个批次
- `429` 优先使用 `Retry-After`，否则回退到指数退避
- 达到 `retry.maxAttempts` 后，图片任务状态转为 `failed`

## 测试策略

- 为 scanner、路径映射、响应解析、错误分类、重试策略和调度器编写单元测试
- 为 SQLite 迁移和图片任务状态转换编写存储测试
- 用 fake image edit client 做续跑与流程集成测试
- 真机 API smoke test 必须显式 opt-in，并由环境变量保护

## 边界

- 总是：把 API key 当作 secret，不打印到输出中
- 总是：允许 API key 来自 `openai.apiKey` 或 `openai.apiKeyEnv`，两者同时存在时 `openai.apiKey` 优先
- 总是：即使文件日志关闭，也保持用户可见进度输出可读
- 总是：不要把原始 API key 或其他 secret 写入日志、持久化日志或结构化诊断数据
- 总是：配置升级必须显式执行；普通 translate / query 命令只允许提示，不允许静默改写配置
- 总是：保留输入目录结构
- 总是：在 API 尝试前后持久化图片任务状态
- 总是：写文件前先解码 `data[0].b64_json`
- 总是：当 `output.formatFromApi` 开启时，以响应 `output_format` 决定最终扩展名
- 总是：当 `output.formatFromApi` 关闭时，保留配置中的规划扩展名
- 总是：通用基础设施优先使用 Deno 标准库或成熟 Deno 依赖
- 总是：优先使用 JSR 依赖，例外情况应记录到规格或任务文档
- 需要先确认：引入 Web 框架、更换 SQLite、接入外部队列服务
- 禁止：提交真实 API key、临时 API 响应和生成图片输出

## 成功标准

- 一份 YAML 配置可以驱动目录级图片翻译
- scanner 能稳定顺序扫描支持的图片文件
- 输出路径保留输入目录结构，并根据 `output.formatFromApi` 决定最终扩展名
- OpenAI-compatible 图像编辑响应能被正确解析并写出
- 瞬时失败能按退避策略重试
- 认证与权限错误能以清晰错误中止批次
- 中断后的批次能续跑且不重复处理已完成输出
- 核心队列与存储逻辑可被未来 Web UI 复用

## 未来架构考虑

当前实现默认一个批次只使用一个 provider 和一个活跃 API key 来源。后续大版本可以扩展为专门的账号调度层。

当前的 run-level cooldown 仅适合单活跃 key 的安全默认行为，不应视为最终调度抽象。

后续方向：

- 在不破坏单 key 路径的前提下支持单 provider 多 key
- 增加 API-key 级 cooldown 与健康状态，避免单 key 限流/额度问题阻断其他健康 key
- 增加 provider 级 cooldown 与健康状态，区分 provider 级故障与 key 级配额问题
- 支持显式 key 选择策略，如 primary-with-failover 与 balanced usage
- 让并发能力随健康 key 数量增长，而不是把所有请求都视为共享一份凭据
- 为每次 attempt 记录 masked key identity 或 key slot 元数据，便于诊断而不暴露 secret
- 最终从单 provider key pool 演进到多 provider account pool
- 支持 provider 级代理配置

未来设计约束：

- key/provider 选择应位于独立调度模块，而不是只埋在底层 image client 中
- secret 永远不能进入日志、CLI 输出或持久化诊断记录
- provider / adapter 的差异应尽量停留在 queue 调度层之下
- 代理配置属于 adapter/client 构造层，而不是 job planning 层
- 多 key 的第一阶段应保持小步演进：单 provider、多 key、确定性轮换
- 新增用户可见配置字段必须谨慎评估升级和文档成本

## 开放问题

- 是否要把 `gpt-image-2-2k` 或 `gpt-image-2-4k` 暴露为预设
- 未来多 key 调度中，attempt metadata 应只存 masked key label，还是同时保留非敏感 logical account id
- 未来多 provider 支持中，provider failover 是自动、策略驱动，还是显式配置
- 未来 provider 代理配置应是全局、provider-specific，还是二者兼有
- 未来 key balancing 初版是否保持简单 round-robin，还是从一开始就考虑 cooldown、quota 和 rate limit
- dry run 开启诊断日志时，是否应写文件，还是只保留 console / memory 诊断
- prompt 未来是否支持按目录或按文件覆盖
- cancel / pause 控制是否只留给未来 Web UI
