# AGENTS.md

本文件定义本仓库中 AI coding agents 的工作方式。除非用户明确要求，否则以下规则优先于一般习惯。

## 一、总原则

- 与用户的对话、说明、任务备注和可见日志默认使用中文。
- 代码中的函数名、方法名、字段名、变量名、文件名和目录名保持英文，并沿用现有风格。
- 优先最小修改，保持清晰分层，不要把全部功能塞进一个文件。
- 只改动与当前任务直接相关的文件，不要顺手重构无关区域。
- 如果发现与当前任务无关的既有改动，先保留，不要擅自回滚。

## 二、项目概述

- 本项目是一个 Deno CLI，用于批量翻译目录中的图片。
- 核心流程是：扫描输入目录、生成持久化任务、调用 OpenAI-compatible `/v1/images/edits`、解码 `data[0].b64_json`、再按原目录结构写入输出目录。
- 关键约束是：保留目录结构、支持 YAML 配置、使用 SQLite 持久化队列、支持重试和断点恢复。
- CLI 只是薄适配层，核心队列、存储和 API 逻辑要尽量保持可复用，方便未来 Web UI 复用。
- 当前规范来源优先看 `docs/spec.md` 和 `docs/tasks.md`；临时 smoke-test 资料只放在 `.local/smoke-test/`，不要提交生成物。

## 三、OpenCode 与技能

- OpenCode 在本仓库通过 `AGENTS.md`、内置 `skill` 工具和项目根 `.opencode/skills` 映射完成技能发现与执行。
- 项目根 `.opencode/skills` 应指向 `../vendor/agent-skills/skills/`，实际技能内容来自 `vendor/agent-skills` 子模块。
- 技能定义路径统一为 `vendor/agent-skills/skills/<skill-name>/SKILL.md`。
- 如果开始工作时发现 `vendor/agent-skills/skills` 不存在或不完整，先检查子模块是否已初始化，不要假设根目录存在独立的 `skills/`。
- OpenCode 虽支持自定义 `/commands`，但本仓库采用“自然语言 + 技能驱动”的方式，不把手工斜杠命令作为主要入口。
- 如果任务命中某个技能，必须先按该技能流程执行，再进入实现。

## 四、技能触发与生命周期

- 新功能、较大改动或需求扩展：先走 `spec-driven-development`，再根据阶段进入 `planning-and-task-breakdown`、`incremental-implementation`、`test-driven-development`。
- 任务拆解、排期或验收标准整理：使用 `planning-and-task-breakdown`。
- Bug、失败、异常行为、测试不稳定：使用 `debugging-and-error-recovery`。
- 代码评审：使用 `code-review-and-quality`。
- 重构、简化、降复杂度：使用 `code-simplification`。
- API、模块边界、契约设计：使用 `api-and-interface-design`。
- 前端界面与交互：使用 `frontend-ui-engineering`。
- 需要官方文档校验时：使用 `source-driven-development`。

生命周期映射：

- DEFINE → `spec-driven-development`
- PLAN → `planning-and-task-breakdown`
- BUILD → `incremental-implementation` + `test-driven-development`
- VERIFY → `debugging-and-error-recovery`
- REVIEW → `code-review-and-quality`
- SHIP → `shipping-and-launch`

## 五、任务执行顺序

1. 先理解用户问题的本质，并用一句话或几点概括出来。
2. 再检查当前实现、现有文档和上游说明，识别差距后再决定方案。
3. 信息不足时，先列出疑点和可选方案，不要直接猜实现。
4. 新功能或较大改动必须先进入规格阶段，不允许直接写代码。
5. 只有用户明确说“进入实现阶段”或 `implement tasks` 后，才开始写代码。
6. 每完成一个 task，就立即更新任务文档并补充实现备注。
7. 需要测试、构建或验证时，必须实际执行并依据结果判断，不要只凭感觉完成。

## 六、规格驱动开发

- 本项目不是把规格放在顶层 `specs/`，而是放在 `docs/` 下，和现有的 `docs/spec.md`、`docs/tasks.md` 保持一致。
- 项目级总纲继续使用 `docs/spec.md` 与 `docs/tasks.md`。
- 功能级规格放在 `docs/specs/<feature>/` 下，推荐文件如下：
  - `docs/specs/<feature>/requirements.md`
  - `docs/specs/<feature>/design.md`
  - `docs/specs/<feature>/tasks.md`
- `requirements.md` 使用 EARS 句式写需求。
- `design.md` 说明架构、数据流、技术决策和边界。
- `tasks.md` 按依赖顺序拆分小任务，并为每项写验收标准。
- 如果工作是项目级重构、共享基础设施或全局流程调整，优先更新 `docs/spec.md` 和 `docs/tasks.md`。
- 不要为了形式搬迁现有文档；保持文档结构与当前项目实际一致。

## 七、实现要求

- 先理解用户问题，再做调研，再形成方案，最后实现。
- 先看当前代码、已有文档和上游说明，再下结论。
- 优先最小可验证变更，避免引入不必要的抽象。
- 不要为了“顺手”改动无关代码、注释或格式。
- 不要在没有验证结果的情况下宣布完成。
- 除非有明确需求，不要添加向后兼容层。

## 八、参考路径

- 技能主目录：`vendor/agent-skills/skills`
- 人物说明：`vendor/agent-skills/agents`
- 编排规则：`vendor/agent-skills/references`
- OpenCode 部署说明：`vendor/agent-skills/docs/opencode-setup.md`
- OpenCode 技能映射入口：`.opencode/skills`
- 若需要了解上游的命令/人物编排，只参考上游文档；本仓库不把斜杠命令当作主要工作入口。
