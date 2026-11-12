# 模型配置与多供应商接入规范（MODELS）

> 本文档描述 WebAgent 框架“模型 / 语音 / 生图 / 决策”的统一接入协议与后台治理边界。
> 面向两类读者：接入新业务系统的开发者，以及在后台维护模型的管理员。
> 设计参考 TencentCloud/Octop 的模型池、供应商卡片、语音分类与决策配置，以下以本仓库实际实现为准。
> 本轮验证使用隔离测试网关和 Mock，没有逐家进行付费认证。管理员点击真实测试会请求所配置的供应商，可能产生费用。

---

## 1. 总体设计与边界

### 1.1 对话核心与专用协议

框架的对话核心实现 **OpenAI 兼容协议**（`provider_type = openai_compatible`）；语音与决策可以在模型中选择已适配的专用协议：

- 对话：`POST {base_url}/chat/completions`（支持流式 SSE、tool_calls、reasoning）
- 模型列表发现：`GET {base_url}/models`（仅用于“拉取模型列表”，非供应商可用性的必要条件）
- 生图：`POST {base_url}/images/generations`（OpenAI Images 协议）
- Embedding：`POST {base_url}/embeddings`（支持连接测试，知识库与索引流程预留）

**不在范围内的原生协议**：

- Anthropic Messages API（`/v1/messages`）
- Gemini `generateContent` / `generativelanguage` 原生协议

这两类供应商只能通过 **任意 OpenAI-compatible 网关/代理** 间接接入（例如 OpenRouter 或其它聚合网关），后台**不会**把 Anthropic / Gemini 标记为“原生已兼容”。

### 1.2 四类模型

后台“模型”页把模型按用途分为四类，同一供应商下可以配置任意多类模型：

| 分类 | model_kind | 说明 | 可作默认主模型 | 支持工具 | 支持推理 |
|---|---|---|---|---|---|
| 对话 | `chat` / `vision` | 主对话、工具调用、推理；`vision` 额外支持图片输入 | ✅ | ✅ | ✅ |
| 语音 | `asr` / `asr_realtime` / `tts` | 录音转文字（STT）与文字转语音（TTS） | ❌ | ❌ | ❌ |
| 生图 | `image_generation` | 文生图，走 OpenAI Images 协议 | ❌ | ❌ | ❌ |
| 决策 | `decision` | 候选工具/Skill 的相关性评分 | ❌ | ❌ | ❌ |

扩展能力（不占四类主 tab）：

- `embedding` / `rerank`：向量化与重排，作为后续知识库/检索接入的扩展能力预留。

每个模型只属于一个 `model_kind`。STT 和 TTS 在语音页分区维护，默认绑定也互相独立。

### 1.3 实现支持边界

**实现支持**：

- 供应商预置：OpenAI / DeepSeek / Qwen(DashScope) / GLM(智谱) / Moonshot(Kimi) / MiniMax / Doubao(火山方舟) / SiliconFlow / OpenRouter / Ollama / LM Studio / 自定义。
- STT：OpenAI Whisper(`transcriptions`) + Qwen 语音(`chat_audio` / `dashscope` 原生)。
- TTS：OpenAI Speech(`/audio/speech`) + DashScope Qwen TTS（以 `speech.py` / `test_speech.py` 落地为准）。
- 决策：OpenRouter Decisions API（Jev / Microsoft）与 Laya 本地服务，及通用 `chat_completions` 评分器。

**不实现**：

- Anthropic / Gemini 原生协议、realtime WebSocket 文件转写、rerank 自动测试、非 OpenAI Images 生图协议。

---

## 2. 供应商品牌预置

后台“常用供应商”提供品牌模板，预置值填充 `base_url` 与常见 `model_id` 下拉候选，均可修改。同一品牌可以建立多个账号或环境连接，一个连接可以关联多个模型。当前模板定义见 `webagent/agent/provider_presets.py`，品牌可用能力以账号权限和实际协议为准。

| 品牌 | base_url（预置） | 典型 model_id | 备注 / 边界 |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4.1-mini`、`gpt-4o-mini-transcribe`、`gpt-4o-mini-tts`、`gpt-image-1` | 对话 / STT / TTS / 生图 |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`、`deepseek-reasoner` | 推理模型 `reasoner` 走思考协议 |
| Qwen（通义） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus`、`qwen-flash`、`qwen3-asr-flash`、`qwen3-tts-flash` | 对话兼容模式；语音可选同源原生端点 |
| GLM（智谱） | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.5-flash` | Coding Plan / 国际站须按账号修改地址 |
| Moonshot（Kimi） | `https://api.moonshot.cn/v1` | `moonshot-v1-32k` | 模型以实际账号返回为准 |
| MiniMax | `https://api.minimax.io/v1` | 拉取或手填 | 仅兼容对话；原生语音未适配 |
| Doubao（火山方舟 Ark） | `https://ark.cn-beijing.volces.com/api/v3` | 模型 ID 或推理接入点 ID | 对话与兼容 Images 的生图模型 |
| SiliconFlow | `https://api.siliconflow.cn/v1` | 拉取或手填 | 音色与参数按供应商配置 |
| OpenRouter | `https://openrouter.ai/api/v1` | `typesafe/jev-1.13`、`microsoft/microsoft-decision-1` | 支持对话连接；决策另配同源 `/api/alpha/decisions` |
| Ollama | `http://127.0.0.1:11434/v1` | 本地已拉取模型，如 `qwen3`、`llama3.1` | loopback 默认免 Key |
| LM Studio | `http://127.0.0.1:1234/v1` | 本地已加载模型名 | loopback 默认免 Key |
| 自定义 | 手填 OpenAI-compatible URL | 手填 model_id | 不依赖 `/models`，可直接按 model_id 测试 |

**边界约定**

1. 所有 `base_url` 必须是完整 `http(s)://` URL，不含凭据、查询参数与片段。
2. `/models` 仅用于“拉取模型列表”发现；自定义供应商可**手填 model_id**，即使没有 `/models` 也能保存并测试模型。
3. **免 Key 仅限 loopback**（`localhost` 或 loopback IP，如 `127.0.0.1` / `::1`）；不限定品牌。非本机容器 host 地址（如 `host.docker.internal`、局域网 IP）仍需配置凭据。
4. 决策端点、语音端点必须与供应商 `base_url` **同源**（scheme + host + port 一致），跨域一律拒绝（防凭据外发，见 §3）。
5. 附加 Header 不允许覆盖 `Authorization` / `X-Internal-Token` 等保留字段。

---

## 3. 凭据与安全

### 3.1 服务端加密

- 所有 `api_key` 在落库前由服务端加密，格式 `enc:v1:<fernet>`。
- 密钥派生自 `WEBAGENT_SECRET_KEY`（默认等于 `WEBAGENT_INTERNAL_SECRET`），Fernet key = SHA-256(secret)。
- 管理接口**只返回** `api_key` 是否已配置（`api_key_set` / 掩码），**永不下发明文**；编辑时留空保留原 Key，显式勾选清除才删除。
- 语音 / 决策 / 生图测试失败信息会把 Key 与 Header 值替换为 `[redacted]`，并脱敏 `data:audio/...`。

### 3.2 请求侧防护

- 语音、决策等“专用端点”统一做**同源校验**：不允许把 A 供应商的 Key 发到 B 域名（Octop 的 `_guard_voice_base_url` 同思路）。
- 供应商 `extra_headers` 校验禁止 CR/LF/冒号注入，并禁止覆盖保留 Header。
- 认证默认 `Authorization: Bearer <api_key>`；loopback 地址允许无 Key。这里只配置供应商认证，不透传业务用户 Token 给模型供应商。

---

## 4. 模型池与角色绑定

### 4.1 模型池

一个供应商下可添加多个模型，构成“模型池”。模型字段（`models` 表）：

- 标识：`name`（显示名）、`model_id`（实际请求 ID）、`sort_order`。
- 能力：`model_kind`、`capabilities`（`["text"]` / `["text","image"]`）、`supports_tools`、`supports_reasoning`、`reasoning_style` / `reasoning_efforts` / `default_reasoning_effort`、`supports_reasoning_summary`、`supports_transcription`。
- 上下文：`context_window`、`max_output_tokens`、`temperature`、`top_p`。
- 计费：`input_price_per_1m`、`output_price_per_1m`。
- 元数据：`metadata_source`（`manual` / `heuristic` / `models.dev`）、`extra_params`（存放 `_asr` / `_tts` / `_decision` / `_reasoning` / `extra_body` 等协议配置）。

### 4.2 角色绑定

各角色的空值语义不同，**不是一律回退到主模型**：

| 角色 | 配置项 | 留空语义 |
|---|---|---|
| 默认主模型 | `models.is_default = 1`（仅 `chat`/`vision` 可作默认） | 未设默认时按 `sort_order` 回退到**第一个启用的 `chat`/`vision` 模型**；非对话类型（`chat`/`vision` 以外）禁止设默认 |
| 降级模型 | `fallback_model_id` | **关闭降级**（不回退） |
| 会话标题生成 | `title_model_id` | 用主模型 |
| 上下文压缩 | `compaction_model_id` | 用主模型 |
| 语音识别（STT） | `asr_model_id` | **关闭 STT**（前端语音按钮置灰） |
| 语音合成（TTS） | `tts_model_id` | **关闭 TTS** |
| 决策 | `decision_model_id` | **决策筛选不可用** |

STT 与 TTS **独立绑定**：两者分别选择自己的模型与供应商，互不影响；未配置即关闭对应能力。

### 4.3 参数自动获取与同步

- 供应商模型下拉：`GET {base_url}/models`，带缓存（TTL 5 分钟、超时 12s），把 `id/name/owned_by` 映射为候选；**无 `/models` 的供应商可直接手填 model_id**。
- 点击“同步模型信息到表单”后，`models.dev/api.json` 目录（本地缓存 6 小时）用于预填 `context_window / max_output_tokens / capabilities / reasoning / 价格`。没有匹配项时提示手工填参，不在页面加载时阻塞等待远端目录。
- 已保存条目的“同步信息”调用 `POST /api/admin/models/{id}/sync`。同步保留所有专用类型和已保存的 `extra_params`；`chat/vision` 可按目录重新推断，同步不会把非对话模型设为默认。

---

## 5. 两开关：BM25 与决策筛选

工具/技能筛选有三个状态（`tool_selection_mode`）：

| mode | 含义 |
|---|---|
| `none` | 不筛选，全部可用候选项进入主 Agent |
| `bm25` | 本地 BM25 关键词检索排序（可关闭） |
| `decision` | 决策模型评分筛选（需先配置决策模型） |

对应“两个开关” `bm25_enabled` 与 `decision_enabled`：

- **两者互斥**：同时开启直接 422 拒绝；开启一个会自动关闭另一个。
- **两者都可关闭**：都关 = `none`。
- 决策模式校验：必须存在**启用的 `decision` 模型**，且至少勾选“工具”或“Skill”之一作为评分范围。

配置入口：`PUT /api/config`（管理员），前端由 React 同组件渲染（§11）。

---

## 6. 决策协议（Jev / Microsoft / Laya）

决策模型用于在主 Agent 运行前，对“候选工具 + 候选 Skill”逐项打 0~1 相关性分，按阈值裁剪后送入主模型，降低 token 与误调用。

### 6.1 两种协议

模型 `extra_params._decision.protocol` 支持：

- `decisions`：原生决策接口（OpenRouter Decisions API / Laya 本地服务）。
- `chat_completions`：复用 OpenAI 兼容对话接口当评分器（`temperature=0`、不传工具），要求输出 JSON。

### 6.2 原生 `decisions` 线格式

请求（`POST {endpoint}`）：

```json
{
  "state": "用户当前意图/上下文",
  "model": "typesafe/jev-1.13",
  "questions": {
    "tool:list_devices": {
      "type": "noul",
      "instructions": "工具 list_devices：查询设备信息",
      "criteria": { "true": "适用", "false": "不适用" }
    }
  }
}
```

- `model` 字段：当 `model_id == "auto"` 时**不发送**（Laya 本地服务自动选型）。
- 响应解析兼容 `answers` / `scores` / `results` 三种容器；单项评分支持 `noul` / `probability` / `p_yes` / `yes` / `score` 取值。

### 6.3 预置决策服务（Octop `DecisionSettingsPanel.tsx` 证据）

| 预置 | 模型 | 端点 | 说明 |
|---|---|---|---|
| Jev | `typesafe/jev-1.13`（别名 `~typesafe/jev-latest`） | `https://openrouter.ai/api/alpha/decisions` | OpenRouter Decisions API |
| Microsoft | `microsoft/microsoft-decision-1` | 同上 | OpenRouter Decisions API |
| Laya | `auto` / `multilingual` / `english` / `typed-decisions` | `http://127.0.0.1:8000/v1/systemone` | 本地服务，Octop 有 `LayaLocalInstall` 拉起组件 |
| 自定义 | 任意 | 同源自定义端点 | `protocol` 可选 `chat_completions` |

> 本仓库 `webagent/agent/decision.py` 已实现上述 `decisions` 协议；`scripts/test_decision.py` 共 25 项测试覆盖分类、开关互斥、线格式、评分解析、阈值、超时、凭据与 fallback。

### 6.4 范围 / 阈值 / 超时 / fallback / 日志

| 项 | 默认值 | 说明 |
|---|---|---|
| 范围 | `decision_tools=1`、`decision_skills=1` | 工具与 Skill 都可独立开/关 |
| 阈值 | `decision_threshold=0.6` | 评分 `>=` 阈值才保留 |
| 最小候选数 | `decision_min_count=8` | 候选数低于此值**不发决策请求**，保留全部 |
| 候选上限 | 200 | 超过则直接 fallback 保留全部 |
| 超时 | `decision_timeout_seconds=5` | 总 deadline，且受全局重试 `max_elapsed_seconds` 约束 |
| 重试 | 复用全局重试配置 | 仅对可重试错误退避重试，达到总 deadline 即停止 |
| fallback | 任何失败/超时/评分无效 → **保留全部候选** | 决策失败不自动转 BM25，不静默丢工具 |
| 日志 | `llm_calls` 表 `purpose="decision"` | 记录 attempt/status/token/成本/延迟；usage 并入本次运行用量 |

---

## 7. STT 协议与独立绑定

ASR 模型 `model_kind ∈ {asr, asr_realtime}`，`extra_params._asr.protocol` 支持：

| protocol | 端点 | 线格式 | 适用 |
|---|---|---|---|
| `transcriptions` | `{base}/audio/transcriptions` | multipart `file` + `model` + `language` | OpenAI Whisper 等 |
| `chat_audio` | `{base}/chat/completions` | `input_audio` 内容块；`data_format=base64` 或 `data_uri` | OpenAI GPT-Audio / Qwen 语音模型 |
| `dashscope` | DashScope 原生 `multimodal-generation/generation` | `input.messages` + `parameters`，`X-DashScope-SSE: disable` | `qwen-audio-3.*` |
| `realtime` | WebSocket | 实时流 | 仅实时；**不支持文件转写**，测试时明确报错 |

- `auto`：按 `model_id` 关键字自动推断（`realtime` / `qwen*asr` / `gpt-audio*` / 默认 `transcriptions`）。
- OpenAI Transcriptions 使用 multipart 原文件；Chat Audio / 原生协议需要时经 FFmpeg 转为单声道 16kHz WAV（缺少转换器时明确提示）。
- 页面测试支持录制或上传实际音频，调用管理员专用转写接口，不修改默认 STT 绑定。旧的通用模型测试 API 仍保留 1 秒静音连通测试，不能据此确认有声识别质量。
- 独立绑定：`asr_model_id`；留空 = 关闭，前端语音按钮置灰。

测试证据：`scripts/test_asr_protocol.py`（ASR 协议 + 推理协议，覆盖四种协议、空转写、跨域拒发、超时归一化、WebM 转 WAV）。

---

## 8. TTS 协议

TTS 已落地于 `webagent/agent/speech.py`，协议 `_tts.protocol` 支持 `openai` 与 `dashscope` 两种：

| protocol | 端点 / schema | 格式 | 默认音色 | 语速 | 文本上限 |
|---|---|---|---|---|---|
| `openai` | `{base}/audio/speech` | `mp3` / `wav` / `opus` / `aac` / `flac` / `pcm` | `alloy` | 0.25 ~ 4.0 | 4000 字符 |
| `dashscope` · `qwen3` | `multimodal-generation/generation` | 固定 `wav` | `Cherry` | 固定 1.0 | 600 字符 |
| `dashscope` · `qwen_audio` | `SpeechSynthesizer`（Qwen-Audio3.x） | `mp3` / `wav` / `opus` / `pcm` | `longanhuan_v3.1` | 0.5 ~ 2.0 | 4000 字符 |

说明与边界：

- **一次性二进制输出，不流式下发到前端**：音频经 `MAX_AUDIO_BYTES`（10 MB）上限约束后一次性返回；PCM 无浏览器可播放预览，管理端提示用户下载播放。
- DashScope 原生返回 `audio.url` 或内联 base64；下载仅允许供应商同源或已核实的 `dashscope-result-bj.oss-cn-beijing.aliyuncs.com`。官方 HTTP 结果地址提升为 HTTPS；下载不跟随重定向、不携带 Key/Cookie。
- TTS 模型独立绑定 `tts_model_id`，与 `asr_model_id` 分开；留空 = 关闭。
- SDK：`SpeechClient.synthesize(token, text, *, voice, response_format, speed, model_row_id) -> (bytes, mime)`；普通用户只使用全局默认 `tts_model_id`，管理员可传 `model_row_id` 指定模型。
- 管理端输入测试文本，真实调用并返回可试听/下载音频；当前聊天页未自动朗读每条回答，业务接入方可调用 Speech API 或 SDK。

测试证据：`scripts/test_speech.py` 共 33 项测试（协议分支、同源/凭据校验、下载边界、大小/超时上限、错误脱敏、管理员测试返回音频等）。

---

## 9. 生图与图片测试

- 生图模型 `model_kind=image_generation`，走 OpenAI Images 协议：`client.images.generate(model, prompt, n=1, **params)`，`n` 固定为 1。
- 模型 `extra_params` 可透传 `size` / `quality` / `style` / `response_format` / `background` / `output_format` / `output_compression` / `moderation`；未配置时 `size` 默认为 `1024x1024`。
- 连接测试统一用固定提示词 `A simple blue circle on a white background`，校验响应里存在 `url` 或 `b64_json`；返回的 `image.data_url`（由 `b64_json` 拼装）或 `image.url` 供前端预览。
- **已知限制**：`1024x1024` 仅为默认测试值，部分品牌/模型不支持该尺寸；测试时按模型实际能力选择受支持尺寸。
- 多模态对话模型的 `capabilities` 含 `image` 时，对话测试与运行时以 OpenAI 视觉消息格式携带图片（只支持图片输入，不做视频/音频输入到主模型）。

> 说明：Octop 的生图预置（`src/octop/infra/agents/settings/media_generation.py`）走 Volcengine Ark / DashScope 原生 / MiniMax 原生。本框架核心仅 OpenAI 兼容，因此**只承诺 OpenAI Images 协议**；上述原生生图接口不在范围，如业务需要可封装为工具/连接器接入。

---

## 10. 模型测试矩阵

管理端模型测试为**真实调用**：强制实际请求供应商，**不受业务 `demo_mode` 影响**（`demo_mode` 只影响聊天/运行时，不影响管理端连接测试）。`POST /api/admin/models/{id}/test` 按 `model_kind` 分派：

| model_kind | 测试动作 | 断言 |
|---|---|---|
| `chat` / `vision` | 发送 `"Hi"`，输出上限 256；支持时关闭思考 | 必须有回复正文，空文本不报成功；回显 usage 与延迟 |
| `asr` | 页面上传/录制真实音频；通用测试 API 使用 1 秒静音 | 返回转写结果；空音频/缺少识别结果不能当真实识别成功 |
| `asr_realtime` | 页面明确禁用文件测试 | 提示实时 WebSocket 尚未实现 |
| `image_generation` | 生图 `blue circle`，默认 `1024x1024` | 返回 `url` 或 `b64_json`（尺寸不支持时按模型能力调整） |
| `tts` | 合成一段测试文本 | 管理端返回可试听音频；demo 测试不伪造成功；PCM 提示下载播放 |
| `decision` | 对“查询设备”单候选评分 | 返回 `score ∈ [0,1]`，回显 usage |
| `embedding` | `embeddings.create("WebAgent connection test")` | 返回向量维度 |
| `rerank` | — | 明确提示“协议因供应商而异，暂不支持自动测试” |

> 供应商“测试”按钮只代表**发现/连接测试**；专用 `decision` / `tts` 等即使供应商没有 `/models`，仍可直接对单个模型测试。

> 除“连接测试”外，ASR/TTS 还提供管理端**真实音频测试**：`POST /api/admin/models/{id}/transcribe` 上传/录制音频转写，TTS 测试返回可试听音频。

---

## 11. 前端接入与业务鉴权

- React 管理界面 `ModelsSettings` 以**同一组件**服务两条入口：
  - 后台嵌入：`/admin/` → AI 配置 → 模型，内嵌 `/react/?view=models&embed=1`。
  - 独立页：`/react/?view=models`，保留返回聊天与业务后台导航。
- 鉴权链路：
  1. 浏览器 → 业务系统 `/api/agent/{path}`（同源代理），业务系统校验 Cookie 登录态，注入当前用户的 `Authorization: Bearer <token>` 与 `X-Internal-Token`。
  2. Agent 验证内部凭据后，用 Bearer Token 向业务身份接口核验用户，并检查返回的 `is_admin`；不能信任浏览器自报角色或 `X-WebAgent-User`。
  3. 模型/供应商管理接口全部要求管理员；普通用户只能读取“可选模型/工具”等非敏感信息。
- 关键端点（均经 `/api/agent` 代理）：

| 端点 | 说明 |
|---|---|
| `GET /api/admin/providers` | 供应商列表（不含明文 Key） |
| `GET /api/admin/providers/presets` | 12 个模板，不创建供应商配置 |
| `POST /api/admin/providers` / `PUT` / `DELETE` | 供应商增删改 |
| `GET /api/admin/providers/{id}/discover-models` | 拉取供应商 `/models` 列表 |
| `GET /api/admin/models` / `POST` / `PUT` / `DELETE` | 模型池管理 |
| `POST /api/admin/models/{id}/sync` | 同步模型参数（models.dev + 远端列表） |
| `POST /api/admin/models/{id}/test` | 按分类连接测试（真实调用） |
| `GET /api/admin/model-suggest?model_id=...` | 模型分类/能力推断 |
| `POST /api/admin/models/{id}/transcribe` | 管理员上传/录制实际音频，测试指定 STT |
| `POST /api/audio/speech` | 已登录用户使用默认 TTS；管理员可指定模型，返回二进制音频 |
| `GET /api/config` / `PUT /api/config` | 读取运行配置 / 管理员更新默认绑定与筛选参数 |
| `GET /api/status` | ASR / TTS 可用状态及原因 |

上表是 Agent 服务原始路径；浏览器通过 BFF 访问时将 `/api/` 换成 `/api/agent/`。可复用 React 组件支持 `baseUrl`、`initialCategory`、`onChanged`，示例见 [前端说明](../frontend/README.md)。

---

## 12. 实现支持清单

> 各品牌预置未逐一进行真实付费认证；协议/边界以 Mock 测试与官方文档为准。

- 12 个供应商模板、多个独立连接、可手输或下拉的模型 ID、按需拉取与同步。
- Anthropic / Gemini 不标记原生兼容，可通过兼容网关接入。
- API Key 服务端密文存储，管理接口不返回明文。
- BM25 与决策两开关互斥、可全关；决策需启用模型和至少一个评分范围。
- STT / TTS 独立绑定、清空关闭；具备真实音频测试及 TTS SDK。
- 决策 25 项、模型设置 18 项、TTS 33 项、ASR/推理协议 16 项自动回归，测试上游均为隔离 Mock。
- React 同组件供 HTML 后台和独立页使用；管理员权限由服务端核验。

---

## 13. 参考来源

| 来源 | 用途 |
|---|---|
| https://github.com/TencentCloud/Octop | 决策/语音/生图/供应商预置的参考实现 |
| Octop `src/octop/infra/migration/common.py` | 供应商发现与迁移设计参考 |
| Octop `src/octop/infra/agents/providers/presets.py` | 供应商预置与推理协议映射 |
| Octop `src/octop/infra/agents/settings/media_generation.py` | 生图/视频供应商预置 |
| Octop `src/octop/infra/voice/presets.py` + `adapters.py` | 语音供应商预置与 OpenAI/Tencent/MiMo 适配 |
| Octop `dashboard/src/pages/Settings/Models/components/DecisionSettingsPanel.tsx` | Jev / Microsoft / Laya 决策端点与模型 |
| OpenAI 官方文档 https://platform.openai.com/docs/api-reference | OpenAI / Speech / Images 协议 |
| DeepSeek https://api-docs.deepseek.com/ | DeepSeek base_url 与模型 |
| 阿里云百炼 https://help.aliyun.com/zh/model-studio/ | DashScope 兼容模式与 Qwen 语音 |
| 智谱 https://open.bigmodel.cn/ · Z.ai https://docs.z.ai/ | GLM base_url 与模型 |
| Moonshot https://platform.moonshot.cn/docs/ | Kimi base_url 与模型 |
| MiniMax https://platform.minimaxi.com/docs/ | MiniMax base_url 与模型 |
| 火山方舟 https://www.volcengine.com/docs/82379 | Ark base_url 与 Doubao 模型 |
| SiliconFlow https://docs.siliconflow.cn/ | SiliconFlow base_url |
| OpenRouter https://openrouter.ai/docs · Decisions API | OpenRouter 兼容层与 Decisions 协议 |
| Ollama https://github.com/ollama/ollama/blob/main/docs/openai.md | Ollama OpenAI 兼容端点 |
| LM Studio https://lmstudio.ai/docs | LM Studio OpenAI 兼容端点 |
| models.dev https://models.dev/api.json | 模型上下文/能力/价格目录 |
