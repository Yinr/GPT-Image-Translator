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
- 续跑身份已收敛为 `runHash`，只纳入 `inputDir`、`outputDir`、`prompt` 和 `scan`
- SQLite schema 已包含 `runs.run_hash` 与脱敏 `run_configs` 快照
- 默认 SQLite 路径为 `./data.db`，CLI 支持 `--db <path>` 临时覆盖
- 查询命令可通过 `--db` 在无配置文件时读取状态库
- `translate --run <runId>` 可从 SQLite 中的 run config snapshot 恢复 `running` run
- 请求代理配置、adapter transport 生命周期和 adapter 内部兼容边界已收敛

详细行为定义见：

- `docs/spec.md`
- `docs/terminology.md`
- `README.md`

## 高优先级

当前无必须在本分支继续完成的高优先级任务。新的功能扩展应另开分支，并先同步规格。

## 中优先级

### 配置与续跑身份

- 增加可选 `config.name`，用于配置检索、列出与操作员记忆
- 设计可容忍兼容 provider / adapter / API key 变化的任务指纹 / 续跑身份
- 为 `translate --run <runId> --config <path>` 设计 snapshot override 合并规则
- 设计显式 identity override 通道，用于输入/输出路径整体迁移等特殊恢复场景
- 设计更严格的输入清单与 changed-input reconciliation 机制
- 评估是否允许通过显式参数恢复 `completed` / `failed` run

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
