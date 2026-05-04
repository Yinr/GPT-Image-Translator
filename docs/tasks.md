# 任务

## 说明

本文件只保留当前仍有价值的任务信息：

- 需要长期保持稳定的已完成能力摘要
- 仍未完成的任务，按优先级分组
- 后续演进方向

实现过程中的中间切片、临时分支背景和已被当前代码稳定吸收的细节，不在本文件重复展开。

## 当前基线

当前主分支已经具备并应保持稳定的能力：

- Deno CLI 入口与基础开发命令：`check`、`test`、`fmt`、多平台 `compile`
- YAML 配置加载、校验、默认值合并与显式配置升级
- 输入目录扫描、输出路径规划、目录结构保留
- OpenAI-compatible 图像编辑请求与响应解析
- SQLite 持久化：`runs`、`jobs`、`attempts`、`outputs`、处理元数据
- 批次执行、重试、续跑、失败查询
- 终端格式化输出、诊断日志、优雅中断
- 长宽比补边预处理与可选 crop-back
- adapter 架构与 `openai` / `gpt2api` / `pic2api` 接入
- `--max-success` 批次执行上限
- `@matmen/imagescript` wasm 本地缓存包装

详细行为定义见：

- `docs/spec.md`
- `docs/terminology.md`
- `README.md`

## 高优先级

### A1. 收敛共享常量与状态元数据

目标：收敛重复的状态字符串、配置选项枚举和 CLI / query 展示映射，减少重复定义。

完成标准：

- `run` / `job` / `attempt` 状态有单一权威定义
- 用户可见状态汇总保持现有行为
- CLI 格式化逻辑不泄漏到 `storage` / `queue` 模块

验证：

- `deno task check`
- `deno task test`

### A2. 收紧查询服务边界

目标：进一步明确 `RunQueryService` 与底层 SQLite row shape 的边界，确保未来 Web UI 直接依赖稳定 DTO，而不是数据库细节。

完成标准：

- Query service 返回稳定 typed DTO
- CLI query commands 只负责格式化 query 结果
- Row mapper 仍保持为 storage 内部实现细节

验证：

- `deno test tests/run_query_service_test.ts tests/query_commands_test.ts`
- `deno task check`

### A4. 收敛续跑身份与配置命名

目标：收敛当前续跑匹配规则，为后续显式 resume 和配置命名能力打基础。

完成标准：

- 明确哪些 `loaded config` 字段属于 `config hash`
- 定义未来任务指纹 / 续跑身份与 `config hash` 的关系
- 设计可选 `config.name`
- 评估显式 `translate --run <runId>` 的最小安全实现边界

验证：

- `docs/spec.md`
- `docs/tasks.md`

### A5. 增加代理配置

目标：为当前 API 接入层增加可选代理配置，并为未来多 provider / 多 key 场景保留扩展空间。

完成标准：

- 请求可通过配置代理发送
- 代理配置可校验并有文档说明
- 代理 URL 中的敏感信息不会进入日志与错误输出
- 测试覆盖代理选项构造，不依赖真实代理服务

验证：

- `deno test tests/openai_client_test.ts tests/config_test.ts`
- `deno task check`

### A6. 继续收口适配器边界

目标：继续把 adapter 特有的请求/响应兼容逻辑从 `queue`、CLI 和共享 helper 中收敛到
`src/adapters/` 边界内。

完成标准：

- `queue` 和 CLI 只依赖共享 adapter 接口
- provider / adapter 差异不再继续泄漏到调度层
- 新增兼容分支优先落在对应 adapter 内部

验证：

- `deno task check`
- `deno task test`

## 中优先级

### 配置与续跑身份

- 增加可选 `config.name`，用于配置检索、列出与操作员记忆
- 梳理 `config hash` 的纳入字段
- 设计可容忍兼容 provider / adapter / API key 变化的任务指纹 / 续跑身份
- 设计不依赖完整 `config hash` 的显式 resume-by-run-id
- 设计更严格的输入清单与 changed-input reconciliation 机制
- 明确是否允许仅依赖持久化 run metadata 实现无配置路径的续跑定位

### 适配器与 API 演进

- 继续提取 adapter-specific 请求/响应行为，保持 queue / CLI 只依赖共享 adapter 接口
- 为 `pic2api + gpt-image-2 + size:auto` 增加最近推荐尺寸映射
- 评估 `402 insufficient balance` 在单 provider / 单 key 模式下的 stop-run 语义
- 设计自定义 `WxH` 输入映射到支持尺寸 / 推荐尺寸的方案
- 评估额外 provider-native 图像流程是否值得通过 adapter capability 暴露

### 多 key / 多 provider 调度

- 设计 API-key 级 cooldown、quota health 与 retry routing
- 设计 provider 级 cooldown 与健康度跟踪
- 设计 attempt metadata 中的非敏感 key label / logical account id 表达方式
- 设计 provider/account transport 生命周期，并迁移当前 `openai.proxy` 到 provider 级代理路由
- 设计从单 provider 多 key 到 provider/account pool 的渐进演化路径
- 引入单 provider 多 key 轮换
- 引入 failover 和 balanced usage 策略
- 让并发能力按健康 key 容量扩展
- 在单 provider 多 key 稳定后，再扩展到多 provider account pool

## 低优先级

### 防御性与运维增强

- 评估缺失 `output_format` 时的防御性输出格式探测 fallback
- 将代理能力进一步扩展到未来 provider 级路由需求
- 设计显式代理连通性诊断入口，例如 `doctor --check-proxy`，不在普通 translate 中默认探测
- 仅在当前输出仍存在歧义时，继续增强用户侧摘要、query 输出和诊断可见性

### 后续路线保留项

- 输出格式 fallback 的可行性与设计
- 多 key 调度架构与 rollout stage
- 多 provider account-pool 架构
- provider 级代理路由与脱敏规则
- 显式代理连通性诊断入口
- 自定义尺寸映射与 provider-native 能力暴露

## 文档维护规则

- `docs/spec.md` 记录当前行为、架构边界和稳定设计决策
- `docs/terminology.md` 记录固定术语与生命周期图
- `docs/tasks.md` 记录未完成任务与优先级
- `README.md` 记录面向用户的快速使用说明
- 临时分支计划、实现切片和已被主线文档吸收的迁移说明，不应继续保留在这里
