# WebAgent：把 Agent 接入现有业务后台的通用 Demo

这是一个可运行的三服务 Demo，用来验证一个核心命题：

> Agent 框架不和业务系统强耦合；Agent 不直连业务数据库，也不持有超级管理员权限。它通过 MCP 或直连 Tool，带着“当前登录用户”的身份调用业务 API。用户的权限，就是 Agent 的权限上限。

Demo 模拟了一张普通业务表（设备信息表），并把 Agent 对话、模型切换、工具选择、写操作审批、管理员治理和审计串成完整闭环。

---

## 1. 现在能体验什么

后台只有三个主菜单：

1. **AI 对话**
2. **设备信息表**
3. **AI 配置**

### 用户侧

- 管理员预定义模型，用户可在对话输入框切换模型。
- 模型支持推理时，可在输入框旁选择模型声明支持的推理等级；支持关闭的模型提供「关闭推理」。固定推理模型不显示虚假的关闭能力。
- 工具按“账号权限 ∩ 助手工具白名单 ∩ 管理员全局开关 ∩ 本轮用户勾选”实时过滤。
- 用户可在「工具」弹层中决定本轮让 Agent 使用哪些工具。
- 新会话自动使用当前账号可用的默认助手，不需要先手动选择。
- 查询类工具直接执行；新增、修改、删除默认返回审批卡，用户批准后才执行。
- 输入框旁可切换「变更前确认 / 完全访问」。完全访问只跳过确认，不扩大账号或工具权限，所有执行仍写审计；管理员可关闭该选项。
- 会话、消息、工具调用、审批和用量保存在 Agent 服务端，按用户隔离。
- 「已发布」读取本地保存的 PagePilot 页面、URL、发布状态和版本，按当前业务账号隔离，可预览、查看 HTML、查询历史和更新自己的页面。
- 每条回答显示本次用量（输入/输出 token、费用、耗时）；会话支持分叉、重命名、删除，消息支持编辑/删除。
- 上下文进度条移到输入框下方，实时显示已用/预算与百分比；右侧面板保留工具、技能、运行预算和会话累计详情。
- 支持手动「压缩上下文」；历史接近预算时会自动压缩。
- 思考原文默认不落库，但实时流式展示、点开可见；管理员可在运行设置开启「保存思考原文」。
- 支持用户手动维护长期记忆，并在相关对话中注入。
- 支持图片附件，前提是所选模型声明了 `image` 能力。
- 对话默认使用 SSE 流式输出。思考、工具调用和生成回答合并成一条过程状态，执行中显示“正在思考 / 正在调用工具”，结束后变成“已完成 · N 个步骤”；不再提供简洁、标准、诊断三档展示。
- 点击过程条展开步骤摘要，再点某个工具展开原始参数与结果。流式文本只更新当前消息节点，避免整页重绘闪烁。
- 对话用 markdown-it 实时渲染安全 Markdown、GFM 表格、KaTeX 公式和 Mermaid 流程图/时序图；模型输出的 HTML 只显示为产物卡片，在隔离 iframe 中预览，可保存 PNG 或发布到 PagePilot。
- 管理员配置 ASR 模型后，输入框旁的语音按钮可用；识别完成后直接发送，未配置时按钮禁用。
- 图表来自受控的 `chart` 代码块，不执行模型生成的 JavaScript；HTML 预览使用 `sandbox="allow-scripts"`，不能读取业务系统登录态。

### 管理员侧

- **模型**：供应商与模型合并为一项配置。填写 OpenAI-compatible Base URL、加密保存 API Key、维护额外 Header 和超时，可从供应商实时拉取模型列表并导入；每个模型单独配置能力、上下文窗口、输出上限、思考强度、多模态、价格和额外参数。
- **模型同步**：新增/编辑模型时模型 ID 支持从供应商列表下拉选择，并可一键「同步模型信息」回填 models.dev / 供应商元数据。
- **默认/备用/辅助模型**：设置全局默认模型、降级模型、标题生成模型、上下文压缩模型和 ASR 模型；标题/压缩模型留空时继承主模型，ASR 未配置时禁用语音输入。
- **助手**：预置不同系统提示词、默认模型、工具白名单和记忆开关；不是多 Agent 编排。
- **工具**：支持 MCP 工具、管理员新增的动态 HTTP 连接器和 PagePilot 发布连接器；四种治理状态（可见可选、可见固定、不可见默认启用、不可见不可用）对所有工具生效，写/删工具也可以隐藏，审批与业务 RBAC 不受影响。
- **PagePilot**：通过官方 REST 接口发布，后台集中保管共享 Token；本地 `publications` 保存业务用户归属，`publication_versions` 保存每次发布的 HTML 快照和结果。用户或 Agent 可查询自己的已发布页面，更新时验证本地归属。每次发布/更新由用户决定密码和可见范围，密码允许为空且不自动生成。后台标题作为拼接后缀，例如「日报（设备运维）」。
- **工具检索**：先做权限、助手白名单和四态过滤，再用 BM25 检索名称、描述、分类和参数名，最多向模型注入 16 个工具 Schema。BM25 可在工具页关闭；关闭后全部可用工具直接进入上下文，适合工具很少但需要完整能力的场景。
- **技能管理**：按 Agent Skills 渐进式加载规范维护 `SKILL.md` 正文、slug、描述、许可证和参考文件。
- **会话管理**：按用户、助手、模型、状态、关键字和时间筛选全部会话，查看消息/工具/审批/压缩/LLM 调用详情，导出 JSON、Markdown 或 CSV。
- **用量统计**：按天、用户、模型查看调用次数、token 和估算费用。
- **用户管理**：查看用户权限，删除普通用户。
- **审计日志**：合并展示业务日志和 Agent 日志。
- **运行设置**：维护最大步数、工具调用上限、运行时长、上下文预算、重试策略、会话保留期、隐私开关、默认执行模式、完全访问开关、空态标题/副标题/问题、默认推理等级和每日 token 额度。

审批记录保存在 SQLite 中，服务重启后仍可继续处理；同一审批使用原子抢占，重复点击不会重复执行。供应商 API Key 使用 `WEBAGENT_SECRET_KEY` 派生的 Fernet 密钥加密落库，接口只返回掩码。

### 演示账号

| 用户名 | 密码 | 权限 |
|---|---|---|
| `admin` | `admin123` | 全部设备权限、用户管理、全部工具 |
| `user1` | `user1pass` | 只能查询设备 |
| `user2` | `user2pass` | 查询 + 修改设备（审批后执行） |
| `user3` | `user3pass` | 查询 + 修改 + 删除设备（审批后执行） |

> 内置“演示模式”只用于不消耗 LLM 的验收：使用确定性意图识别调用真实业务工具，不是真实大模型回答。界面会标明演示状态；关闭演示模式但未配置模型时会明确报错，不伪造模型输出。

---

## 2. 架构

```text
┌──────────────────────────── Browser ────────────────────────────┐
│  同源页面：AI 对话 / 设备信息表 / AI 配置                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HttpOnly Cookie
                               ▼
┌──────────────────── 业务系统 :8000 ─────────────────────────────┐
│  登录、会话、RBAC、设备 CRUD、业务审计、静态前端                 │
│  /api/agent/* 同源代理：校验会话后注入 Bearer Token             │
└───────────────┬───────────────────────────────▲─────────────────┘
                │ X-Internal-Token              │ Authorization: Bearer <user-token>
                ▼                               │
┌──────────────── Agent Gateway :8010 ──────────┴─────────────────┐
│  模型选择、工具过滤、Agent loop、技能注入、审批、配置管理        │
│  不 import 业务代码，不连接业务数据库                            │
└───────────────────────────────┬─────────────────────────────────┘
                                │ MCP + 用户 Bearer Token
                                ▼
┌──────────────────── MCP Tool Server :8020 ──────────────────────┐
│  FastMCP 工具清单、JSON Schema、风险元数据                       │
│  每个工具都只是携带用户 Token 去调用业务 REST API                │
└───────────────────────────────┬─────────────────────────────────┘
                                │ REST + 用户 Bearer Token
                                └──────────────► 业务系统 /api/*
```

三个服务故意拆开：

- **业务系统**拥有数据和最终授权边界。
- **MCP 服务**只做能力适配，不读业务库。
- **Agent 服务**只负责推理、工具编排和治理，不知道设备表如何存。

更多设计说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 3. 快速启动

### Docker Compose（推荐）

需要 Docker Engine、Compose v2 和可拉取基础镜像的网络：

```bash
python3 scripts/init_env.py
COMPOSE_BAKE=false docker compose up -d --build --wait
docker compose ps
```

打开 <http://127.0.0.1:8080>（完整 HTML 管理台）或 <http://127.0.0.1:8080/react/>（React 聊天组件入口）。初始管理员为 `admin`，随机密码保存在本机私有 `.env`，不在日志中输出。Compose 使用独立数据卷，不会迁移或覆盖本地 `data/`；模型与工具配置需在该实例配置。普通演示账号仍如上表，正式部署应关闭演示用户种子。

完整的网络、持久化、备份恢复、安全边界与排错步骤见 [容器部署手册](docs/DEPLOYMENT.md)。

### Python 本地开发

要求 Python 3.11+、Node.js 22+（本地 Python 3.14、容器 Python 3.13 已验证）。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
(cd frontend && npm ci && npm run build)
python run_demo.py
```

打开 <http://127.0.0.1:8000>，React 在 <http://127.0.0.1:8000/react/>。构建同时复制 Markdown、公式和图表的本地资源；不再依赖外部 CDN。启动脚本不自动读取 Compose 的 `.env`，本地开发环境变量需自行导出。也可以：

```bash
python run_demo.py --open
```

启动脚本会同时拉起：

- 业务系统：`127.0.0.1:8000`
- Agent 服务：`127.0.0.1:8010`
- MCP 服务：`127.0.0.1:8020`

日志在 `logs/`，SQLite 数据在 `data/`。

已有服务占用端口时启动脚本会拒绝重复启动；修改 `WEBAGENT_*_PORT` 可调整三个本地端口。

HTML 产物的“保存图片”由服务端 Playwright 渲染。Demo 会优先使用系统 Chrome/Chromium；如果机器上没有，可执行：

```bash
python -m playwright install chromium
```

截图时 JavaScript 被关闭、外部网络请求被阻断，避免模型生成的 HTML 在服务端回连内网。

语音录音常见为浏览器生成的 WebM/Opus 或 MP4；Chat Audio / DashScope 适配会在需要时调用系统 FFmpeg 转为单声道 16 kHz WAV。需要语音功能时安装 FFmpeg 并确保服务进程能找到 `ffmpeg`；缺少转换器时返回明确错误。模型协议与配置示例见下文「语音识别协议」。

### 使用真实 LLM

用 `admin` 登录 → `AI 配置 → 模型`：

1. 新增模型，在合并表单中填写供应商信息与 OpenAI-compatible Base URL。
2. 填写 API Key（加密保存在 Agent 服务端，前端只显示掩码）。
3. 拉取模型列表后选择模型 ID，或手工输入模型 ID，再同步模型元数据。
4. 测试供应商连接，并在「模型」中确保目标模型已启用。
5. 在「运行设置」中关闭「演示模式」。

任何 OpenAI-compatible 网关都可以：OpenAI、DeepSeek、通义、OneAPI、NewAPI、vLLM 等。

模型能力可以从 models.dev 元数据预填；拉取失败时回退到本地启发式。模型请求不会把 API Key 放进上下文。修改 `WEBAGENT_SECRET_KEY` 会导致已有密文无法解密，需要重新填写供应商 API Key，生产环境应把该值放入 Secret Manager 并妥善轮换。

### 接入 PagePilot

PagePilot 提供的是本地 stdio MCP（`pagep-mcp`），本框架的 MCP 客户端只连接远程 HTTP MCP，因此没有把 stdio 进程伪装成远程 MCP，而是使用官方 REST 发布接口：

1. 用 `admin` 登录 → `AI 配置 → 工具 → PagePilot 发布连接器`。
2. 填写 PagePilot Base URL 和 Bearer Token，保存后点「测试连接」。
3. 启用连接器。工具治理中会出现 `publish_to_pagepilot`（写入风险，默认需要审批）。
4. 模型可以调用该工具发布 HTML；HTML 预览里的「发布到 PagePilot」也走同一后端代理。
5. 每次发布或更新都由用户确认标题、可选说明、访问密码和可见范围；系统禁止自动生成密码。密码填空表示不设访问密码，`unlisted` 只表示不公开列出，知道 URL 的人仍可访问。Agent 调用前必须询问并获取本轮密码/可见范围选择。
6. 在「已发布」选择本地 `publication_id` 更新自己的页面；兼容传入 `code`，但必须已经属于当前账号的本地记录。其他用户或本地未知的旧 `code` 均不允许更新。
7. 发布列表、详情和历史版本均查询本地数据库，不会用共享 Token 从 PagePilot 拉取整个业务系统的站点列表。旧远端页面不自动导入，也不根据会话或 URL 猜测归属。

新建和更新均使用官方 `POST /api/deploy`。更新时后端从当前用户的本地记录取得 `customCode`，同时传 `enableCustomCode=true`、`createVersion=true` 追加版本，并核对返回的 code；不能把未知 code 当成新建请求重试。密码与可见范围先走各自的 PATCH 接口，仅在返回 404/405 时回退到官方 `POST /api/deploys/{code}/access/set`、`POST /api/deploys/{code}/visibility`；超时和 5xx 不触发兼容回退。新建时用户提供的非空密码也随内容请求的 `accessPassword` 一起提交。

发布成功后会保存内容、返回 URL、远端版本、可见范围与 `password_set` 标记，不保存访问密码明文。内容已发布但密码或可见范围设置失败时返回 `status=partial` 和 `warning`；界面应保留链接并提醒用户核对，不能显示为全部成功或自动重试创建新页面。

该协议依据 PagePilot [公开 OpenAPI](https://pagepilot.chaoxi.live/openapi.json)、[生产网页脚本](https://pagepilot.chaoxi.live/app/assets/index.js)及[官方 Skill/CLI 包](https://pagepilot.chaoxi.live/skill/pagep.zip)的只读核查，并由隔离 Mock 回归覆盖；本轮没有通过远端发布写入验证这些兼容路由，部署后仍需按目标服务做授权验收。

Token 使用 Fernet 加密落库，接口只返回掩码。单文件上限 3 MB，要求完整 HTML 文档。后台标题和说明支持 `{title}`、`{date}`、`{user}` 占位符；标题规则是「用户标题（后台后缀）」，用户不填标题时使用后台值加日期。`session_id` 仅记录来源，真正的所有者来自服务端确认的业务 `user_id`。删除会话、清空消息或 30 天会话清理不会删除发布内容与版本；部署时需单独规划发布记录的容量、备份和清理策略。

业务 BFF 转发 `GET /api/agent/pagepilot/publications`、详情与版本接口即可复用「已发布」能力；服务端 SDK 提供 `PagePilotClient`。完整接口、更新和鉴权示例见 [接入手册](docs/INTEGRATION.md#35-pagepilot-发布连接器)。

### 重置演示数据

停止服务后删除 `data/business.db` 和 `data/agent.db`，再次启动即可重新写入种子数据。

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WEBAGENT_BUSINESS_PORT` | `8000` | 业务系统端口 |
| `WEBAGENT_AGENT_PORT` | `8010` | Agent 服务端口 |
| `WEBAGENT_MCP_PORT` | `8020` | MCP 服务端口 |
| `WEBAGENT_DATA_DIR` | `./data` | SQLite 目录 |
| `WEBAGENT_INTERNAL_SECRET` | Demo 默认值 | Agent ↔ MCP 内部服务密钥，生产必须修改 |
| `WEBAGENT_SECRET_KEY` | 默认复用内部密钥 | 供应商 API Key 等敏感配置的加密根密钥，生产必须独立设置并持久化 |
| `WEBAGENT_SESSION_HOURS` | `24` | 登录会话有效期 |
| `WEBAGENT_SESSION_COOKIE` | `wa_session` | 本地会话 Cookie 名；Compose 默认 `wa_container_session`，避免本地多实例串号 |
| `WEBAGENT_COOKIE_SECURE` | `0` | HTTPS 部署设为 `1`；HTTP 本地开发保持 `0` |
| `WEBAGENT_ADMIN_PASSWORD` | `admin123` | 仅首次初始化业务库使用；Compose 使用 `.env` 的随机值 |
| `WEBAGENT_SEED_DEMO_USERS` | `1` | 是否在新业务库创建 user1/2/3；设为 `0` 不会删除已有用户 |
| `WEBAGENT_MCP_HEALTH_URL` | MCP 同源 `/health` | 使用不同健康端点时显式覆盖 |

> 生产环境应把 Agent 和 MCP 放在私网，只有业务 BFF 能访问 Agent；不要把 8010/8020 暴露到公网。

---

## 4. 一次工具调用是怎么继承权限的

以 `user2` 说“把 2 号设备状态改为维护中”为例：

```text
1. 浏览器只请求业务系统 /api/agent/chat，携带 HttpOnly Cookie。
2. 业务系统校验会话，把原始用户 Token 注入 Authorization，转发给 Agent。
3. Agent 调业务系统 /api/me，重新确认用户身份和权限。
4. Agent 调 MCP list_tools，读取工具元数据：
   permission=device:update; risk=write; category=设备
5. Agent 做四层过滤：
   用户权限 ∩ 助手工具白名单 ∩ 管理员全局启用 ∩ 用户本轮勾选
6. LLM 选择 update_device，risk=write，且当前为「变更前确认」，Agent 不执行，先返回审批卡。
7. 用户批准；若用户已选择「完全访问」且管理员允许，则跳过这一步，但仍沿用同一用户 Token 和权限过滤。
8. Agent 调 MCP update_device，仍然携带 user2 的 Token。
9. MCP 请求业务系统 PATCH /api/devices/2，仍然携带 user2 的 Token。
10. 业务系统执行最终 RBAC 校验；成功后才写库并记录 agent-mcp 审计。
```

即使有人在浏览器里伪造 `user_id=1`、修改前端开关或直接调用 Agent 接口，也拿不到额外权限：

- Agent 不信任浏览器传来的用户 ID。
- Agent 接口要求内部服务密钥。
- 工具执行始终使用当前会话 Token。
- 业务 API 是最后一道，也是最终的授权边界。

### 4.1 SSE 事件与断线恢复

`POST /api/agent/chat/stream` 返回 `text/event-stream`，响应头带 `X-Run-Id`。事件 ID 单调递增，主要事件包括：

| 事件 | 用途 |
|---|---|
| `run.started` | 模型、供应商、演示模式和本轮工具已确定 |
| `context` | 上下文预算和是否发生压缩 |
| `thinking.delta` | 供应商返回的思考增量，实时展示；默认不落库，受 `store_reasoning` 配置控制 |
| `tool.started` / `tool.finished` | 工具执行过程和结果摘要 |
| `tool.approval_required` | 写/删操作等待用户批准 |
| `retry` / `model.fallback` | LLM 重试与降级模型切换 |
| `usage` / `session.title` | 本轮用量、会话标题更新 |
| `run.completed` / `run.failed` | 本次运行最终状态 |

客户端断线后可用 `GET /api/chat/stream/{run_id}` 加 `Last-Event-ID` 恢复。运行记录按用户校验，不能恢复其他用户的流；服务端会重放缺失事件，并在 `run.completed` 后自动关闭连接。事件协议详见 [docs/INTEGRATION.md](docs/INTEGRATION.md)。

### 4.2 工具四态

管理员对每个工具设置以下四种状态之一：

| 状态 | `visible` | `selectable` | `default_selected` | 用户侧表现 |
|---|---:|---:|---:|---|
| 可见可选 | 1 | 1 | 1 | 用户可勾选或取消 |
| 可见固定 | 1 | 0 | 1 | 始终勾选且不可取消 |
| 不可见默认启用 | 0 | 0 | 1 | 用户看不到，但 Agent 默认可用 |
| 不可见不可用 | 0 | 0 | 0 | 用户看不到，Agent 也不可用 |

四种状态对所有工具生效，包括写和删除工具。隐藏写/删工具只影响用户是否能手动勾选，不会跳过审批，也不会改变业务 API 的最终 RBAC。管理员还可以新增动态 HTTP 工具，调用时自动透传当前登录用户 Token，由业务 API 做最终授权。

BM25 是上下文优化，不是权限层。关闭后所有通过权限、助手白名单和四态过滤的工具都会进入模型上下文；开启时最多注入 16 个最相关的 Schema。

### 4.3 对话执行模式

用户可以在输入框旁选择：

- **变更前确认**：`write/delete` 工具生成审批卡，批准后才执行。默认值更安全。
- **完全访问**：`write/delete` 跳过审批直接执行，但工具可见性、账号权限、助手白名单、BM25 过滤和业务 API 最终 RBAC 全部不变。管理员可以在「运行设置」中禁止用户选择。

每次运行会把 `approval_mode` 写入响应、会话和审计。它解决的是“交互确认策略”，不是权限提升。

### 4.4 为什么不做 Craft / Plan / Ask 多模式

本项目的核心是“业务后台里的受控执行助手”，不是文件工程 Agent。Craft/Plan/Ask 这类模式会把“能否改文件”“是否只读”与业务权限混在一起，容易让用户误以为切换模式就能扩大数据权限。当前保留两条更清晰的轴：

- 助手类型：`多步` / `单步报告`，决定是否预采集只读数据后生成报告。
- 执行策略：`变更前确认` / `完全访问`，只决定写操作是否先询问。

真正的业务数据边界始终由账号 RBAC 和业务 API 决定。

---

## 5. 怎么做成“接入任何业务系统”的通用框架

通用化的关键不是把 Agent 写得更复杂，而是把接入面收敛成四份契约。

### 契约一：身份契约

目标系统需要提供一种让适配层确认“当前用户是谁”的方式：

- 已有 Session / Cookie：业务 BFF 负责换出短期 Token。
- 已有 OAuth2 / OIDC：透传 access token，并在 `/api/me` 返回权限。
- 企业 SSO：在 BFF 内完成登录，再签发内部短期 Token。

建议统一返回：

```json
{
  "user": {
    "id": "u_123",
    "username": "alice",
    "display_name": "Alice",
    "permissions": ["device:read", "device:update"],
    "is_admin": false
  }
}
```

### 契约二：能力契约

把目标系统的一部分 API 注册成 MCP 工具。不要一上来把几百个接口全暴露：

- 先选 5～10 个高频、边界清晰的业务动作。
- 工具参数使用明确 JSON Schema。
- 错误返回统一结构，保留业务错误码和权限错误。
- 写操作尽量支持幂等键。

每个工具都必须带元数据：

```text
[META] permission=device:update; risk=write; category=设备 [/META]
```

建议风险等级：

| 风险 | 示例 | 默认行为 |
|---|---|---|
| `read` | 查列表、查详情、统计 | 直接执行 |
| `write` | 新增、修改、启停 | 默认审批；完全访问下直接执行 |
| `delete` | 删除、清空、撤销 | 默认强提示 + 审批；完全访问下直接执行 |

### 契约三：审计契约

至少要记录：

- 谁（用户名 / 用户 ID）
- 通过什么来源（`web` / `agent-mcp`）
- 做了什么（工具名 / 业务动作）
- 操作对象
- 参数摘要和结果
- 是否经过审批、谁批准

业务系统和 Agent 两侧都要审计。只记录 Agent 日志不足以证明业务数据发生了什么。

### 契约四：嵌入契约

前端不必和 Agent 服务直连。推荐：

- 业务系统提供 `/api/agent/*` 同源代理。
- 浏览器只认识业务系统域名。
- Agent 服务在私网，通过内部密钥和业务 BFF 通信。
- 对话 UI 可以是独立页面、iframe、Web Component 或业务系统原生组件。

---

## 6. Agent 运行时

运行时是自研的单 Agent loop，没有引入外部 Agent 框架。这里的“助手”是数据库中的一组配置（提示词、默认模型、工具白名单、记忆开关），不是多个自治 Agent 互相协作。

### 6.1 模型接入

首批只实现 OpenAI-compatible 协议：

- 管理员在「模型」页一次完成供应商和模型配置，不需要在两个页面来回切换。
- 供应商级配置：Base URL、加密 API Key、额外 Header、超时、启停。
- 模型级配置：模型 ID、显示名、默认模型、文本/图片能力、工具调用能力、上下文窗口、最大输出、Temperature、Top P、输入/输出价格、额外参数。
- 模型类型：`chat`、`vision`、`asr`、`asr_realtime`、`embedding`、`rerank`、`image_generation`。类型决定默认能力、工具调用能力和测试方式；实时语音模型不能直接用于上传录音文件，重排模型暂不支持自动测试。
- 思考能力：`supports_reasoning`、可用思考强度 `reasoning_efforts`、默认强度；按模型协议发送 `reasoning_effort`、`thinking.type` 或 `enable_thinking`，显式关闭会覆盖额外参数中的默认开启值。
- 语音转写：模型可标记 `supports_transcription`，并在运行设置中指定 ASR 模型。
- 支持从 `/models` 拉取远端模型并批量导入，也支持手工填写模型 ID。
- 模型元数据优先从 models.dev 获取，失败时回退到本地启发式。
- 可单独配置降级模型、标题模型和压缩摘要模型；未配置时继承当前主模型。
- 预留 `provider_type` 字段，后续可扩展其他协议，但当前不承诺。

#### 语音识别协议

语音输入是「录音 → ASR → 文本发送」，不是实时语音通话。模型的 `supports_transcription=true` 仅是能力声明，不代表供应商一定支持某条接口；在运行设置指定 ASR 模型前，应先验证实际协议。

| `extra_params._asr.protocol` | 请求方式 | 典型用途 |
|---|---|---|
| `auto` | 根据模型名及供应商地址选择 | 默认值，识别结果仍须实际测试 |
| `transcriptions` | multipart `POST /audio/transcriptions` | Whisper / OpenAI 文件转写兼容接口 |
| `chat_audio` | `POST /chat/completions`，`input_audio` | Qwen3-ASR-Flash 兼容模式 / Chat Audio |
| `dashscope` | 原生 `/api/v1/services/aigc/multimodal-generation/generation` | Qwen 原生语音接口 |

例如 Qwen3-ASR-Flash：

```json
{"_asr": {"protocol": "chat_audio"}}
```

标准 Chat Audio 使用 Base64 加 `format`；Qwen 兼容模式默认使用音频 data URI。高级配置可填写同源 `endpoint` 覆盖路径，以及 `data_format=base64|data_uri`。`_asr` 是框架元数据，不会被塞进普通聊天请求。实时 `*-realtime*` 模型自动识别为 WebSocket 协议，当前录音上传入口会明确拒绝；不能靠改成 `asr` 类型让它变成文件接口。

本轮对已配置供应商使用 1 秒静音做过低成本验证：`qwen-audio-3.1-realtime-plus` 的 `/audio/transcriptions` 返回 404；同一网关的 `qwen-audio-3.0-asr-flash` 原生路由返回 `model ... is not allowed on this route`，Chat Audio 也返回 400。因此不能声称该真实语音配置已可用。协议实现、静音返回、录音转换与错误处理由 `scripts/test_asr_protocol.py` 的隔离 HTTP Mock 回归覆盖；真实可用性仍依赖供应商为相应模型开放正确协议。

#### 关闭深度推理

- DeepSeek 混合推理模型：发送 `thinking: {"type": "disabled"}`；开启时使用 `enabled` 与模型允许的等级。
- Qwen 混合推理模型：发送 `enable_thinking=false`，开启则为 `true`。
- 标准兼容模型：仅当模型声明支持 `off/none` 时发送 `reasoning_effort=none`。不同模型的支持等级不同，不能统一猜测。
- 固定推理模型如 DeepSeek-R1、`deepseek-reasoner`、QwQ 或明确的 `*-thinking` 不承诺可以关闭；选择不支持的关闭设置会报清楚的能力错误。`supports_reasoning=false` 的模型不发送推理控制参数。

代理有自定义映射时可在 `extra_params._reasoning.protocol` 指定 `effort` / `thinking` / `enable_thinking`，默认 `auto`；`can_disable=false` 可显式禁用关闭选项。对当前 `deepseek-v4.1-flash` 的真实测试已收到不含思考字段的 `Hi`，但此次上游响应约 17 秒，关闭推理不等于保证低首字延迟。

### 6.2 上下文预算与压缩

一次请求的可用上下文预算按以下方式估算：

```text
context_window = 模型 context_window，未配置时用全局 context_max_tokens，再回退 32768
max_context = context_window，若全局 context_max_tokens > 0 再取 min
reserved_output = min(模型 max_output_tokens, max_context / 2)
budget = max_context - reserved_output - context_reserve_tokens
```

压缩有三类触发：

| 触发 | 条件 | 行为 |
|---|---|---|
| 自动 | 估算 prompt token 超过 `budget` | 在 user 消息边界切分，保留最近对话，较早部分生成摘要 |
| 溢出 | 供应商返回 `context_length_exceeded` 等错误 | 强制本地压缩一次后重试 |
| 手动 | 用户点击「压缩上下文」 | 立即压缩，返回压缩前后 token 和节省量 |

压缩规则：

- 只在 user 消息边界切分，避免把一轮对话拆断。
- `compaction_keep_ratio` 控制保留最近对话的比例。
- 摘要优先调用后台配置的摘要模型。
- 摘要模型留空时继承当前主模型。
- 摘要调用失败不阻塞对话，自动回退本地摘要，并记录失败原因。
- 每次压缩写入 `compaction_events`，记录触发方式、前后 token、摘要模型和耗时。
- 压缩摘要不会自动写入长期记忆。

### 6.3 运行上限

每个请求都受以下配置约束，助手可以覆盖全局值：

- `max_iterations`：Agent 最多推理/工具循环步数（助手字段为 `max_steps`）。
- `max_tool_calls`：单次运行最多工具调用次数。
- `max_run_seconds`：单次运行最长墙钟时间。
- `user_daily_token_limit`：每用户每日 token 上限，`0` 表示不限制。

超过工具次数或运行时长会返回明确错误；超过每日额度返回 `429`。

### 6.4 长期记忆

当前只做“用户手动维护的事实型记忆”：

- 用户在界面上添加、启停、删除。
- 只有启用的记忆会注入 system prompt。
- 最多注入最近 20 条。
- 全局或助手级 `memory_enabled` 可以关闭。
- v1 不做自动抽取、自动改写和跨用户共享。

### 6.5 用量与费用

每次模型请求的每一次尝试都写入 `llm_calls`，包括失败尝试。成功响应会累计：

- 输入 token、输出 token、总 token。
- 按模型每百万 token 单价估算的费用。
- 重试次数、耗时、用途（chat/summary）。

会话上累计工具调用、工具失败、审批拒绝、重试、压缩和错误次数。用户可在右侧面板看到本轮和会话累计数据，管理员可在会话管理和用量统计中查看全局数据。

### 6.6 LLM 异常重试

重试由框架统一控制，`AsyncOpenAI` 自带重试已关闭，避免双重重试。

默认策略：

```text
最多 3 次尝试；初始退避 800ms；倍率 2.0；最大退避 8000ms；
抖动 20%；单次请求总重试时长上限 60 秒；优先遵守 Retry-After。
```

可重试：超时、连接错误、`408`、`409`、`425`、`429`、`500`、`502`、`503`、`504`。

不重试：`401`、`403`、`404`、`422` 以及其他明确的客户端错误。

退避策略是全局设置，不做供应商级覆盖。每次尝试都有记录，响应里包含 `attempts`、`retry_count` 和 `latency_ms`。

### 6.7 Skill 渐进式加载

Skill 是知识型能力，不执行脚本，也不因为加载 Skill 而获得任何工具权限。

加载流程：

1. system prompt 只列出已启用 Skill 的 `slug`、名称、描述和加载提示。
2. 模型判断需要时调用内置工具 `load_skill(slug)`，读取 `SKILL.md` 正文。
3. 需要参考文件时调用 `read_skill_file(slug, path)`。
4. 只能读取 Skill 中显式登记的 `files`，路径穿越会被拒绝。

可执行动作必须做成 Tool/MCP；Skill 只负责“告诉模型怎么做”，不负责“替模型执行”。

### 6.8 会话治理

- 普通用户只能访问自己的会话。
- 管理员或拥有 `session:read_all` 权限的角色可以查看全部会话。
- 会话详情包含消息、附件、工具调用参数与结果、审批记录、压缩事件和逐次 LLM 调用。
- 查看和导出都会写 Agent 审计：`admin.session.view`、`admin.session.export`。
- `admin_session_content=0` 时，管理员仍能看到元数据和统计，但正文、工具参数和结果会被隐藏。
- `session_retention_days` 默认 30 天；大于 0 时，Agent 启动会清理超过保留期的会话及其消息、压缩事件和 LLM 调用，设为 0 关闭自动清理。生产环境建议改为「归档 + 宽限期 + 物理删除」，当前 Demo 直接物理删除。

---

## 7. 接入一个新系统的推荐步骤

### 第 1 步：梳理权限

不要用“角色名”直接控制工具。把权限拆成稳定的 action code：

```text
order:read
order:create
order:refund
customer:read
customer:export
```

工具元数据只引用 action code，具体角色如何映射由业务系统决定。

### 第 2 步：包装业务 API

为现有系统写一个薄适配层：

- REST → MCP：最常见。
- GraphQL → MCP：适合已有 GraphQL 网关。
- gRPC / 内部服务 → MCP：适合微服务。
- 无 API 的老系统：先写一个内部 Adapter Service 包住 service 层，仍然不要让 Agent 直接拿数据库账号。

### 第 3 步：实现 MCP 工具

工具函数只做三件事：

1. 读取当前用户 Token。
2. 调用业务 API。
3. 把结果整理成模型可读的 JSON。

对应代码：`webagent/mcp_server/server.py`。

如果只是接入少量已有 HTTP API，也可以不写 MCP Server，直接在「AI 配置 → 工具 → 新增工具」中创建动态 HTTP 工具。动态工具至少需要：名称、描述、权限 action code、风险等级、HTTP 方法、URL 模板、输入 JSON Schema。运行时会把当前用户 Bearer Token 注入 `Authorization`，不会保存到工具定义里。

### 第 4 步：接入 Agent Gateway

Agent 侧只需要：

- `GET /api/me` 获取身份与权限。
- `list_tools` 获取工具清单。
- 按用户权限/助手白名单/全局开关/本轮勾选过滤。
- 调用模型。
- 写工具默认需要审批；完全访问只跳过确认，不扩大权限。
- 执行工具时继续透传用户 Token。

对应代码：`webagent/agent/runtime.py`。

### 第 5 步：业务系统做同源代理

浏览器不直接访问 Agent：

- 校验 Cookie / Session。
- 注入 `Authorization: Bearer <user-token>`。
- 注入内部服务密钥。
- 转发请求并保持同源。

对应代码：`webagent/business/app.py` 的 `/api/agent/{path}`。

### 第 6 步：按权限矩阵做测试

至少覆盖：

- 有权限的用户 + 对应工具。
- 无权限的用户 + 对应工具。
- 管理员全局停用工具。
- 用户本轮取消勾选工具。
- 读工具直接执行。
- 写/删工具审批通过。
- 写/删工具审批拒绝。
- 完全访问跳过审批但权限不扩大，审计仍记录。
- 审批过期、跨用户审批、重复审批。
- 业务 API 直接越权调用（必须仍被拒绝）。
- 普通用户访问管理员会话接口（必须返回 403）。
- 管理员查看/导出会话（必须写审计）。
- 长上下文自动压缩与手动压缩。
- LLM 可重试错误与不可重试错误。

可以运行本仓库的冒烟测试：

```bash
python scripts/smoke_test.py
```

---

## 8. 为什么这样设计

### 为什么不让前端直接跑 Agent loop

参考项目 Agent2API 展示了很好的前端工具清单、确认卡和模型网关分层。但企业后台通常还需要：

- API Key 不下发浏览器。
- 工具权限在服务端二次校验。
- 审批、审计、限流、模型路由统一治理。
- 多用户之间严格隔离。

所以本 Demo 把 Agent loop 放在服务端，前端只负责交互和审批展示。

### 为什么不让 Agent 直接读数据库

直连数据库会绕过：

- 业务校验
- 行级/字段级权限
- 审计
- 事务和幂等
- 业务规则

因此 MCP 工具只调用业务 API。哪怕工具层被攻破，它拿到的也只是当前用户 Token，而不是数据库超级权限。

### 为什么用 MCP

MCP 提供了标准化的工具清单、JSON Schema 和传输协议。业务系统只需要实现一个 Adapter，Agent 侧不需要为每个系统写一套私有插件协议。

### 为什么工具选择要做四层交集

```text
最终可用工具 = 账号权限 ∩ 助手工具白名单 ∩ 管理员全局开关 ∩ 用户本轮勾选
```

- 账号权限决定“能不能”。
- 助手工具白名单决定“这个助手该不该有”。
- 管理员开关决定“系统允不允许”。
- 用户勾选决定“这一轮想不想用”。

任何一层都不能替代其他层。

### 参考项目带来的启发

- 宝塔 `bt-ai-code`：服务端 Agent loop、工具风险分级、按需技能、审计与确认闸。
- Agent2API：模型网关分层、工具 manifest、前端确认卡和工具选择体验。

本仓库为独立实现，没有复制参考项目源码。若后续要复用 Agent2API 代码，请注意其 AGPL-3.0 许可；宝塔代码也需确认授权与版权边界。

---

## 9. 目录结构

```text
webagent/
  config.py                 三服务共享配置
  common/security.py        PBKDF2 密码与不透明会话 Token
  business/
    db.py                   用户、设备、会话、业务审计
    auth.py                 登录、会话、RBAC
    app.py                  业务 API + Agent 同源代理 + 静态前端
  mcp_server/
    server.py               FastMCP 工具、工具元数据、内部密钥
  agent/
    db.py                   模型、工具四态、技能、设置、用量、审批、Agent 审计
    mcp_client.py           携带用户 Token 的 MCP Client
    llm.py                  OpenAI-compatible 调用、重试、费用、system prompt
    context.py              上下文预算、摘要压缩、溢出兜底
    sessions.py             会话、消息、记忆、会话统计
    providers.py            模型发现、models.dev 元数据、Base URL 规范化
    crypto.py               API Key 加密与旧明文迁移
    dynamic_tools.py        管理员配置的动态 HTTP 工具
    tool_search.py          工具目录 BM25 检索
    pagepilot.py            PagePilot 发布连接器
    runtime.py              工具过滤、Demo/真实 Agent loop、审批、运行上限
    app.py                  Agent Gateway API
  sdk.py                    业务系统接入 SDK（直连 Tool 注册、FastAPI 帮助函数）
web/
  index.html
  styles.css
  app.js
frontend/                    React + TypeScript 组件库（Vite）
  src/components/            Markdown / CodeBox / HtmlArtifactCard / ProcessLine / ApprovalCard / Composer
  src/styles/                组件样式与设计变量
run_demo.py
requirements.txt
scripts/smoke_test.py
docs/ARCHITECTURE.md
docs/INTEGRATION.md
```

---

## 10. 当前 Demo 的边界

这是用来讨论架构和交互的 Demo，不是直接可上生产的成品：

- 审批状态已持久化到 SQLite，但 SQLite 仍适合单机/小规模部署；多实例生产环境建议换成 PostgreSQL，并使用分布式锁或数据库原子更新。
- 没有接入企业 SSO、OAuth2、多租户组织树。
- 已有 SSE 流式、工具过程事件和按 `Last-Event-ID` 断线重放，但没有做多副本之间的运行记录共享。
- 工具支持 MCP 与动态 HTTP Connector，但还没有可安装的 Connector 包格式和版本管理。
- 目前只有按用户每日 token 上限的轻量额度控制，没有按模型/租户的精细预算、并发限流和账单对账。
- 没有做 PII 脱敏、长期审计归档和跨实例分布式锁。
- 长期记忆只支持手动维护，不做自动抽取。
- 删除业务用户只删除业务账号；Agent 侧会话和审计默认保留，生产需按合规要求做级联删除或匿名化。
- 演示模式的意图识别只覆盖设备场景，真实效果应使用 LLM。
- Skill 只做知识型渐进式加载，不执行脚本；如果未来允许脚本，必须单独设计沙箱、权限声明、资源限额和审计，不能直接复用当前 Skill 权限模型。
- 暂不实现 `soul.md` / `AGENTS.md` 式多文件人格与租户知识库上传隔离；接入边界和预留字段见对接手册。
- 暂不实现 PDF/音频聊天解析；图片走 OpenAI-compatible 多模态消息，语音仅用于 ASR 转写后发送文本。
- `web/` 是原生 HTML/JS 管理台；`frontend/` 是独立 React + TypeScript 接入界面和可复用组件，接真实登录、对话、发布与记录接口。本轮没有把整个原生管理台完全迁移到 React；二者复用同一后端鉴权和发布契约，接入时可按业务技术栈选用。

下一步产品化建议：

1. 把 MCP 适配器抽成 Connector SDK / 模板。
2. 把运行记录和审批迁移到共享数据库/Redis，支持多实例与横向扩容。
3. 加入租户、组织、数据域、知识库和记忆隔离。
4. 接入 OIDC / SSO，统一短期 Token 交换。
5. 加限流、配额、模型路由、提示词版本和审计归档。
6. 做 Connector 市场：每个业务系统一个可安装适配器。
