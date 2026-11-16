# 模型与供应商

## 1. 接入方式

当前主对话统一采用 **OpenAI Chat Completions 兼容协议**，通过 PI `openai-completions` provider 执行。供应商卡片只是连接模板，不代表已取得供应商原生 SDK 的全协议支持。

一个供应商连接保存 Base URL、加密 Key、自定义请求头和超时；可以为同供应商建立多个账号 / 环境连接，每个连接可挂多个模型。模型按用途在独立管理端统一配置：

- 对话：`chat` / `vision`，图片作为标准多模态输入。
- STT：`asr` / `asr_realtime`，分别是文件或实时协议。
- TTS：`tts` / `tts_realtime`，分别用于普通合成与实时语音通话。
- 生图：`image_generation`，OpenAI Images 测试协议。
- 决策：`decision`，不出现在 Chat 主模型列表。
- 向量化：`embedding`，OpenAI `/embeddings` 协议，管理端校验有限数值向量与维度。
- 重排：`rerank`，常见 `/rerank` 协议，管理端校验 `index + relevance_score`。

每一种用途都支持多个供应商连接、同一供应商的多个账号 / 环境连接，以及完全自定义的 OpenAI 兼容连接。提供 OpenAI、DeepSeek、百炼、GLM、Kimi、MiniMax、豆包、SiliconFlow、OpenRouter、Ollama、LM Studio 与自定义连接模板。远端仍需实际启用对应模型和地域。

## 2. 新增与同步

1. 添加 / 选择供应商连接，填写实际 Base URL 与 Key。
2. 在当前用途分类添加模型。
3. 点击拉取模型列表，下拉按当前类型过滤；支持手工输入未被列表返回的模型 ID。
4. 点击同步模型信息，取得 models.dev 或已知推测信息，检查后保存。
5. 点击「测试」，验证该用途的真实请求。

供应商模型列表在每次点击时实时请求，不跨点击缓存；同一连接会合并在途并发请求。10 秒上游超时，不自动遍历供应商所有模型，不在打开编辑弹窗时阻塞界面。某些供应商不提供模型列表，不能因此认定模型不可用。

models.dev 与供应商实时列表不同：它用于补全模型窗口、输出上限、价格和能力。手动同步最多等待 5 秒，成功后只回填这些权威字段到编辑表单，不会直接修改数据库，也不会覆盖温度、Top P、推理等级或 ASR / TTS / 决策专用配置；取消编辑即可放弃。没有缓存时同步会触发后台刷新并提示稍后重试，不会把 32768 / 8192 的推断值静默写成权威值。缓存优先读取 `data/cache/models-dev.json`，并兼容迁移到 `data/legacy-backup/models_dev_cache.json` 的旧 `_fetched_at + data` 格式。

匹配会优先使用与当前供应商 `base_url` 同源同路径的 models.dev 供应商条目，再做模型 ID 精确匹配；例如 `coding.dashscope.aliyuncs.com` 命中 `alibaba-coding-plan-cn`，国际站命中 `alibaba`。`:thinking`、`:free` 等路由后缀和日期快照会归一化，`plus` / `flash` / `mini` 等变体不会互相误配。无法查到则 `metadata_source: inferred`，不是供应商保证。窗口、输出上限、价格、图片和推理能力须按实际模型检查。

中国大陆网络无法直连 models.dev 时，可设置 `WEBAGENT_MODELSDEV_URL` 指向镜像或本地 JSON 地址，并用 `WEBAGENT_MODELSDEV_TIMEOUT_SECONDS` 调整拉取超时（默认 120 秒）。

编辑已有模型也可拉列表与同步，保留 `_asr` / `_tts` / `_decision` 专用配置。供应商返回的 opaque endpoint ID 可能无法推测用途，可手动选择类型。

## 3. 对话与推理

主对话请求始终由 PI 流式执行。管理端普通连通测试发送 `Hi`，返回真实答复、用量和耗时，不使用静态演示文本。

常见推理参数并非完全统一：

| 配置 | 行为 |
| --- | --- |
| `effort` | `reasoning_effort`，适合兼容 OpenAI 的服务 |
| `enable_thinking` | Qwen3 兼容端点的布尔开关 |
| `thinking` | DeepSeek 等 `thinking.type` 开关 |

默认按模型 ID 推测，可在高级参数 `_reasoning.protocol` 指定。模型可声明允许等级和默认强度；不支持关闭的固定思考模型不要声明 off。供应商不返回思考字段时页面不能凭空展示。

额外 JSON 禁止覆盖 `model`、`messages`、`tools`、`stream`、身份和地址等框架保留字段，防止绕过工具授权。模型不支持工具时不注入工具 / Skill 定义。PI 默认 Shell 和文件工具未开放；只有部署者设 `WEBAGENT_LOCAL_TOOLS=admin` 且管理员逐项启用后才进入运行时候选。

上下文有效上限为模型窗口与助手 / 全局上限中的限制值；输出预算与安全余量另外预留。用户切换模型时，Chat 输入框下预算跟随模型变化，实际运行后端也按所选模型计算；锁定助手模型不允许前端绕过。

## 4. STT 语音识别

| 协议 | 默认端点 | 说明 |
| --- | --- | --- |
| `transcriptions` | Base URL + `/audio/transcriptions` | multipart 文件上传，如 whisper |
| `chat_audio` | Base URL + `/chat/completions` | `input_audio` 多模态内容，如 Qwen ASR 兼容端点 |
| `dashscope` | `/api/v1/services/aigc/multimodal-generation/generation` | 百炼原生音频请求 |
| `realtime` | `/api-ws/v1/realtime` | WebSocket；浏览器将录音处理为 16kHz PCM，再经后端代理上游 |

`qwen3-asr-flash-realtime` 推测为实时 ASR，不强行调用 `/audio/transcriptions`。自动协议依模型 ID 与供应商地址选择，表单可覆盖。端点覆盖要求与配置供应商同源；不同地域 / 域名请另建连接。

测试需录制或上传实际音频，不使用静音文件假装成功。支持 12 MB 内输入，浏览器用 Web Audio 解码并重采样为 16kHz WAV；服务端仅校验并代理，不依赖 ffmpeg。Chat 未绑定启用的默认 STT 时语音按钮禁用；普通录音结束后默认只把识别文本回填输入框，是否自动发送由 `voice_auto_send` 或助手覆盖决定。

输入框旁的语音输入有两种模式：文件 STT 整段采集后识别；实时 STT 在录音过程中持续回填输入框。右上角「语音通话」使用独立实时链路：浏览器 VAD 后逐帧上传 16 kHz PCM，后端代理 `asr_realtime`，并与同一会话的 TTS 输出、打断和审批暂停配合；该按钮需要实时 STT 与 TTS 都已配置。所有语音槽位都可在「运行设置 → 语音与朗读」配置，助手设置可逐项覆盖，留空继承全局。

## 5. TTS

- OpenAI：`POST /audio/speech`，`input`、voice、response_format、speed，返回音频。
- DashScope：Qwen3-TTS 原生多模态端点，读取 `output.audio` 的 Base64 或可信下载域名结果。
- 旧 Qwen Audio 语音合成可使用对应 SpeechSynthesizer 端点。
- 默认自动识别 Qwen TTS；专用参数存 `_tts`。
- Qwen3-TTS 单次最多 600 字符、WAV、语速 1；其他音色和参数按供应商文档。

管理端可输入测试文字，真实生成后试听 / 下载；STT 和 TTS 默认绑定独立。Chat 右上角提供最终回答的朗读开关，可在当前页面打开自动朗读；服务端只发送过滤后的正文，不读工具调用、HTML、Markdown 标记、表格或链接。业务前端也可调用 `/api/agent/audio/speech` 自行加入入口。实时语音通话使用 `tts_realtime`；普通文本 TTS 与实时通话 TTS 是两条独立链路。

## 6. 决策模型

决策不是主对话，也不是额外的业务权限模型。运行时顺序：

```text
业务鉴权 → 当前授权候选 → 决策评分 → 筛选后工具 / Skill → PI 主模型 → 实际调用
```

- 两个开关 BM25 / 决策互斥，**可全部关闭**。
- BM25 是 PI 内置本地关键词检索，工具描述延迟发现，无向量数据库，也不调用 Embedding。
- 决策使用单独模型，增加一次评分延迟，适合几十个工具的候选相关性缩减。
- 候选不足阈值不调用决策；超时 / 无效评分保留原已授权候选，不自动切 BM25。
- 固定启用工具不会因评分丢失；权限不足工具不可能因高分加入。

原生 Decisions / SystemOne 与普通 Chat JSON 评分两种协议：

| 服务 | 端点 / 适配 |
| --- | --- |
| 百炼 `decision-model-preview` | 自动兼容模式 `/systemone` |
| OpenRouter Jev / Microsoft Decision | 配置 `/api/alpha/decisions` |
| 已部署的 Laya | 自填实际 `/v1/systemone`，后台不会安装或启动 Laya |
| 普通 OpenAI 兼容模型 | `chat_completions`，要求输出完整候选 JSON 0–1 评分 |
| 自定义 Decisions | 填写同源端点，响应须符合支持的候选评分结构 |

原生输入包含 `state` 与 `questions`，响应解析 `answers` / `scores` / `results`；逐一校验全部候选的有限 0–1 数字。普通评分服务不保证任何自定义协议通用兼容，必要时开发适配器。

管理端模型测试展示请求、原始响应和评分。在「会话与诊断 → 执行与决策」可查看真正使用与否、候选数量、所选能力、耗时和阈值。原始运行 IO 只短期内存可用，默认约 1 小时，进程重启失效；不是完整持久化 tracing 系统。

## 7. 辅助模型绑定

| 用途 | 留空时 |
| --- | --- |
| 降级对话模型 | 不降级；仅主模型失败且无工具 / 输出时才可能尝试指定备用 |
| 压缩摘要模型 | 本次主模型 |
| 会话标题模型 | 本次主模型，异步生成，不阻塞首个回答 |
| 长期记忆提取模型 | 摘要模型，再回退全局默认对话模型 |
| STT / TTS | 对应语音能力关闭；助手设置可覆盖全局槽位 |
| 决策 | 无有效绑定不能开启决策 |

绑定模型必须启用、供应商可用且类型匹配。停用模型仍需用户在后台修复或清空绑定；删除被绑定的模型会拒绝，避免静默改变运行行为。

## 8. 生图与扩展

管理端生图测试调用 OpenAI `/images/generations`，固定 `n=1`，允许安全白名单 size、quality、style、background、output_format 等参数；可能收费。模型配置 / 测试不等同于已开放生图工具，业务需要注册有明确权限的原生 Tool 或连接器。

搜索、和风天气、知识库和其他第三方能力同理：接入为工具，不把未配置的服务伪装为开箱即用。当前通用基础内置日期时间和 PagePilot 专用能力。

Embedding / Rerank 目前是「可配置、可真实测试的模型接入」，不等于已内置知识库检索或向量索引。业务需要时，注册检索 Tool 调用这些模型，并按当前业务身份过滤文档范围；也可以把 RAGFlow、IMA 等作为 MCP / 原生 Tool 接入。

## 9. 错误排查

1. 先看模型类型、地域、Base URL 和实际端点，不要所有语音请求都换成 transcriptions。
2. 供应商列表失败不等于调用失败，直接填写已开通模型 ID 单独测试。
3. HTTP 400 / 401 / 403 先核对参数 / 额度 / 权限，不做无意义连续重试。
4. 查看管理端用途与耗时，区分 decision、chat、compaction、title、memory、asr。
5. 本地 Mock 测试验证协议代码，不替代真实音频质量、供应商开通状态和音色可用性验收。
