# Pic2API 适配说明

## 范围

本文档记录 `pic2api` adapter 与本仓库默认 OpenAI 图像编辑假设之间的重要差异，只保留对本项目实现有影响的约束和扩展，不复制其完整官方文档。

实现时参考的资料：

- 官方文档：`https://www.pic2api.com/user/api-docs`
- 本地快照：`.local/doc/pic2api.md`

## 已确认的相关端点

- `POST /v1/images/generations`：图像生成
- `POST /v1/chat/completions`：带图像输入的 chat 风格图像生成
- `GET /v1/models`：模型列表

文档声称其支持 OpenAI-compatible 接口，因此在没有明确不兼容证据前，翻译器应继续优先使用现有的 OpenAI-compatible 图像编辑路径。

## `gpt-image-2` 差异

### 尺寸行为

- `pic2api` 下的 `gpt-image-2` 不支持 `AUTO` 尺寸行为
- 如果 `size="auto"`、`aspect_ratio="auto"`，或两者都省略，接口可能回退到原生 `1:1` 输出
- 文档中 `size` 以像素尺寸 `WxH` 表示，并按 1K / 2K / 4K 给出推荐尺寸组

文档给出的推荐尺寸：

- 1K：`1024x1024`、`1280x720`、`720x1280`、`1536x1024`、`1024x1536`、`1152x864`、`864x1152`、`1120x896`、`896x1120`、`1456x624`
- 2K：`2048x2048`、`2560x1440`、`1440x2560`、`2496x1664`、`1664x2496`、`2304x1728`、`1728x2304`、`2240x1792`、`1792x2240`、`3024x1296`
- 4K：`2480x2480`、`3328x1872`、`1872x3328`、`3056x2032`、`2032x3056`、`2880x2160`、`2160x2880`、`2784x2224`、`2224x2784`、`3808x1632`

当前仓库决策：

- 继续保留当前固定 OpenAI 风格图像编辑路径和 aspect-pad 预处理能力
- 对 `pic2api + gpt-image-2 + size:auto`，应按源图比例与当前质量档位，从推荐尺寸中选择最近值
- 即使引入该尺寸选择，也继续保留现有预处理和 crop-back 行为
- 暂不在用户配置中暴露任意 provider-native `WxH` 尺寸

### 质量行为

文档中的质量档位与分辨率层级映射为：

- `standard` / `1k` -> 1K
- `hd` / `2k` -> 2K
- `4k` / `high` / `ultra` -> 4K

当前仓库决策：

- 保留现有用户侧质量值
- 如后续继续扩展 `pic2api` 模式，再引入 adapter-aware 的质量到档位映射

## 尚未采用的图像编辑扩展

文档还包含以下流程，但本仓库当前未接入：

- `POST /v1/chat/completions` + `image_url` parts 的 image-to-image / 多图输入
- `POST /v1/images/generations` + `image_urls`
- 非 `gpt-image-2` 模型下的自动宽高比行为

当前仓库决策：

- 这些 adapter-specific 流程暂不接入
- 等 client / adapter 抽象进一步扩展后，再决定是否开放

## 错误处理说明

文档中与当前实现相关的状态码：

- `401`：API key 无效或已过期
- `402`：余额不足
- `403`：禁止访问
- `429`：触发限流
- `500`：服务端错误
- `502`：上游不可用

后续关注点：

- 评估 `402` 是否应在单 provider / 单 key 模式下直接视为 stop-run 错误
