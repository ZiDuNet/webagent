# WebAgent 业务系统对接手册

本文面向“拿到一个新的业务系统，需要把 Agent 嵌入进去”的开发场景。目标是只写适配层，不改 Agent 核心。

## 1. 最小接入面

业务系统至少需要提供四类能力：

1. **身份确认**：根据当前请求返回用户、角色和权限 action code。
2. **业务工具**：把要开放给 Agent 的 REST/GraphQL/gRPC 能力包装成 MCP 工具或动态 HTTP 工具。
3. **同源代理**：浏览器只访问业务域名，由业务 BFF 把用户 Token 注入 Agent 请求。
4. **审计**：记录工具调用、审批、业务写入和来源。

推荐的请求链：

```text
Browser
  -> 业务 BFF /api/agent/*
      - 校验 HttpOnly Cookie / Session
      - 注入 Authorization: Bearer <user-token>
      - 注入 X-Internal-Token
  -> Agent Gateway
      - 调 /api/me 重新确认身份
      - 做权限、助手白名单、工具四态、用户勾选过滤
  -> MCP / 动态 HTTP 工具
      - 仍然携带同一个用户 Token
  -> 业务 API
      - 执行最终 RBAC 和业务校验
```

Agent 不信任浏览器传来的 `user_id`，也不接受“管理员替用户执行”的隐式身份切换。

## 2. 身份契约

业务系统提供一个 Agent 可调用的当前用户接口，例如：

```http
GET /api/me
Authorization: Bearer <user-token>
```

返回：

```json
{
  "user": {
    "id": 123,
    "username": "alice",
    "display_name": "Alice",
    "role": "operator",
    "permissions": ["device:read", "device:update"],
    "is_admin": false
  }
}
```

约定：

- `permissions` 使用稳定 action code，不用“角色名”直接控制工具。
- 工具只声明所需 action code，例如 `device:update`。
- 业务 API 必须再做一次权限校验，Adapter 的过滤只是第一道。
- Token 需要短期、可撤销，并建议绑定 audience。
- 当前 Demo 的身份与归属字段使用稳定整数 `id`。业务系统使用 UUID/字符串用户 ID 时，应在可信身份适配层做稳定映射，或统一修改身份/存储契约；不能在前端临时生成数字，也不能回收旧用户 ID 给另一个账号。
- 当前不实现多租户；多个业务系统若共享 Agent 实例，必须先增加业务/租户命名空间并贯穿用户、会话、发布记录查询，或各自部署实例，不能直接混用各系统可能重复的数字用户 ID。

## 3. 工具接入

### 3.1 MCP 工具

适合工具较多、需要独立演进、需要复用 MCP 生态的系统。

每个工具至少包含：

```json
{
  "name": "update_device",
  "description": "修改指定设备。执行前需要用户审批。",
  "input_schema": {
    "type": "object",
    "properties": {
      "device_id": {"type": "integer"},
      "status": {"type": "string", "enum": ["在线", "离线", "维护中"]}
    },
    "required": ["device_id"]
  },
  "permission": "device:update",
  "risk": "write",
  "category": "设备"
}
```

在 Demo 的 MCP Server 中，这些元数据写在工具描述尾部：

```text
[META] permission=device:update; risk=write; category=设备 [/META]
```

工具实现只做三件事：

1. 从请求上下文读取当前用户 Token。
2. 调用业务 API。
3. 把业务结果整理成 JSON 返回。

禁止：

- Adapter 直连业务数据库。
- Adapter 持有超级管理员 Token。
- 暴露 `execute_sql`、`call_any_api`、`run_script` 这类万能工具。
- 用模型参数决定租户、用户或权限边界。

### 3.2 动态 HTTP 工具

适合少量已有 REST API，不想为每个接口写 MCP 代码。

管理员在「AI 配置 → 工具 → 新增工具」填写：

- 工具名、显示名、描述
- 权限 action code
- 风险等级：`read` / `write` / `delete`
- HTTP 方法
- URL 模板，例如 `http://127.0.0.1:8000/api/devices/{device_id}`
- 输入 JSON Schema
- 可选附加 Header

路径参数从输入 Schema 中取值并替换 `{device_id}`；其余参数：

- `GET` / `DELETE` 作为 query 参数。
- `POST` / `PUT` / `PATCH` 作为 JSON body。

运行时自动注入：

```http
Authorization: Bearer <当前用户 Token>
Accept: application/json
```

不允许通过工具定义覆盖 `Authorization`、`Host`、`Content-Length`，也不允许 Header 中出现换行。

### 3.3 工具四态

| 状态 | 含义 | 用户是否可见 | 用户是否可取消 |
|---|---|---:|---:|
| 可见可选 | 默认展示，用户自行勾选 | 是 | 是 |
| 可见固定 | 默认展示，始终启用 | 是 | 否 |
| 不可见默认启用 | 不展示，但 Agent 默认使用 | 否 | 否 |
| 不可见不可用 | 不展示，也不执行 | 否 | 否 |

四种状态对所有工具生效，写和删除工具也可以隐藏。隐藏只影响用户侧可见性，不改变审批与业务 API 的最终 RBAC。

最终可用工具的计算顺序：

```text
账号权限
  ∩ 助手工具白名单
  ∩ 管理员四态配置
  ∩ 用户本轮勾选
  -> BM25 检索
  -> 最多注入 16 个工具 Schema
```

BM25 的作用不是“向量记忆”，而是工具很多时减少模型上下文占用。它只对已通过权限和四态过滤的工具做名称、描述、分类和参数名检索。

### 3.4 直连 Tool：业务系统已有数据接口时的接入

小程序、老后台等场景往往已经有完整的数据接口，不想为了 Agent 再起一个 MCP 进程。此时直接用「动态 HTTP 工具」或代码级 SDK 注册即可，本质是把已有接口声明成 Tool：

```python
from webagent.sdk import ToolSpec, AgentAdminClient

spec = ToolSpec(
    name="list_orders",
    description="查询当前用户的订单列表，支持状态筛选",
    input_schema={
        "type": "object",
        "properties": {"status": {"type": "string", "enum": ["paid", "unpaid"]}},
    },
    risk="read",
    permission="order:read",
    method="POST",
    url_template="https://your-api.example.com/internal/orders/list",
)

client = AgentAdminClient(
    agent_url="http://127.0.0.1:8010",
    business_url="http://127.0.0.1:8000",
    internal_secret=internal_service_secret,
)
token = client.login(admin_username, admin_password)
client.upsert_tool(token, spec)
```

`webagent/sdk.py` 还提供 `serve_tools()`，给 FastAPI 业务系统一键暴露「工具元数据 + 调用」两个约定端点，方便把已有 service 函数直接映射成 Tool。非 FastAPI 框架只要实现同样的两个端点即可，不需要引入任何 Agent 依赖。

`login()` 兼容响应的 `token`/`access_token`，也兼容 Demo 的 HttpOnly 会话 Cookie。Compose 的 Cookie 名不同，调用时传 `session_cookie_name="wa_container_session"` 或配置同名环境变量；不要为了 SDK 把 Cookie 改成浏览器可读。已有 SSO 系统通常直接把业务 BFF 校验得到的用户 Token 交给 SDK，而不是再次密码登录。

`serve_tools()` 强制传入业务鉴权回调。下面的 `business_identity`、`business_orders` 是接入方自己的业务模块，不是框架内置的管理员凭据：

```python
from fastapi import FastAPI, HTTPException
from webagent.sdk import serve_tools
from my_business import business_identity, business_orders

app = FastAPI()

async def authorize(request, spec):
    user = await business_identity.from_authorization(request.headers.get("Authorization"))
    if user is None:
        raise HTTPException(401, "登录已失效")
    if spec and spec.permission not in user.permissions:
        raise HTTPException(403, "没有该操作权限")
    return user

async def handler(name, arguments, user):
    if name == "list_orders":
        return await business_orders.list_for_user(user, status=arguments.get("status"))
    raise HTTPException(404, "工具未注册")

serve_tools([spec], handler, authorize=authorize)(app, prefix="/agent-tools")
```

`authorize(request, None)` 用于元数据列表的身份校验，`authorize(request, spec)` 用于每次执行的身份与 action code 校验；返回 `None` 会拒绝请求。`handler(name, arguments, user)` 接收的用户只来自该回调，不能使用参数里的 `user_id`。同步和异步回调均支持。输入 Schema 是提供给模型的契约，不代替业务接口的字段、对象归属与业务规则校验；可在回调中使用自己的 Pydantic 模型。

此帮助函数不会自动注册工具；应把 `spec.url_template` 指向 `https://业务域名/agent-tools/list_orders`，用 `upsert_tool()` 注册。`GET /agent-tools` 是发现元数据，不是执行授权边界。现有 MCP 通过环境变量 `WEBAGENT_MCP_URL` 连接远程 HTTP 服务；当前没有后台新增任意 stdio/SSE MCP 服务器的完整管理功能，不应把动态 HTTP 工具入口描述成三种 MCP 传输均已实现。

鉴权融合的关键规则：

- Agent 调用直连工具时**透传当前登录用户 Token**（`Authorization: Bearer <user-token>`），业务接口必须再次校验该 Token 对应的 action code，而不是信任工具名。
- 工具层不做租户/用户推断。所有 `user_id`、`tenant_id`、`org_id` 都来自业务侧解析后的 Token，绝不能由模型参数传入。
- 写/删工具必须声明 `risk`，Agent 会走审批卡；审批通过后的执行同样带用户 Token，最终落库仍由业务 API 的 RBAC 兜底。

### 3.5 PagePilot 发布连接器

PagePilot 提供的 MCP Server 是**本地 stdio** 进程（`pagep-mcp --server ... --token ...`），不是远程 streamable HTTP 端点。本框架的 MCP 客户端固定连接远程 HTTP MCP，因此没有把 PagePilot 伪装成 MCP，而是通过它的官方 REST 接口接入：

```http
POST {pagepilot_base_url}/api/deploy
Authorization: Bearer <pagepilot-token>
Content-Type: application/json

{
  "content": "<!doctype html>...",
  "title": "设备运维日报",
  "description": "由 WebAgent 发布",
  "filename": "index.html"
}
```
新建与更新都使用 `POST /api/deploy`。新建时用户明确提供的非空密码通过 `accessPassword` 随内容一起提交；内容写入后，再设置访问密码和可见范围。更新请求使用官方追加版本模式，在上述内容字段之外同时加入：

```json
{
  "customCode": "owned-code",
  "enableCustomCode": true,
  "createVersion": true
}
```

`customCode` 必须由后端从当前用户在当前 PagePilot 地址下的本地记录取得，不能直接接受用户给出的未知 code。三个字段必须一起传；普通 `code` 不是 `DeployRequest` 的字段，不能照搬旧更新请求体后盲目 POST 新建。框架还会核对响应 code，若与更新目标不一致则停止后续设置，提示核对远端状态。

后台「AI 配置 → 工具 → PagePilot 发布连接器」维护：

- Base URL
- Bearer Token（Fernet 加密落库，接口只返回掩码）
- 启用开关
- 默认标题后缀、发布说明模板（支持 `{title}` / `{date}` / `{user}`）和默认可见范围

启用后工具目录提供 `publish_to_pagepilot`，以及查询本地记录的 `list_published_pages`、`get_published_page`：

- 风险等级：`write`，默认走审批卡。
- 发布参数包括 `html`、`title`、`description`、`filename`、`access_password`、`visibility`，可用 `publication_id` 或兼容的 `code` 更新本地已有页面。
- 每次新建和更新都让用户决定访问密码、可见范围。Agent 必须先询问是否设置密码，再传本轮明确选择；`access_password=""` 允许任何知道 URL 的人访问，禁止自动生成密码。`unlisted` 只是隐藏于公开列表，不代表有密码。
- 标题规则：用户标题 +「（后台后缀）」，例如「日报（设备运维）」；用户不填标题时使用后台后缀加日期。
- 单文件上限 3 MB，要求完整 HTML 文档。
- 发布审计记录用户、站点 code、本地记录 ID、版本、URL 和大小；本地只保存 `password_set`，不保存访问密码明文。

HTML 预览中的发布按钮走后端代理 `/api/agent/pagepilot/publish`，Token 不会进入浏览器。预览本身使用 `sandbox="allow-scripts"` 且不允许同源，模型 HTML 不能读取业务登录态。

远端 API 清单（所有请求均由后端使用配置的 Base URL 和共享 Bearer Token 发起）：

| 方法与路径 | 请求与用途 |
|---|---|
| `POST /api/deploy` | 新建使用 `content/title/description/filename` 等字段；更新额外带本地归属的 `customCode`、`enableCustomCode=true`、`createVersion=true` |
| `PATCH /api/deploys/{code}/access` | `{"password": "..."}` 设置密码，空串清除 |
| `POST /api/deploys/{code}/access/set` | 设置密码的官方兼容别名，仅在前一条 PATCH 返回 404/405 时调用，请求体相同 |
| `PATCH /api/deploys/{code}/visibility` | `{"visibility": "public"}` 或 `{"visibility": "unlisted"}` |
| `POST /api/deploys/{code}/visibility` | 可见范围的官方兼容别名，仅在前一条 PATCH 返回 404/405 时调用，请求体相同 |

超时、5xx 和其他错误不会触发兼容回退；内容写入也不通过换路由自动重试，以免结果未知时重复创建站点或版本。注意 `POST /api/deploys/{code}/access` 是访客验证密码接口，**不是**设置密码的兼容路由。

接口设计依据为 PagePilot [公开 OpenAPI](https://pagepilot.chaoxi.live/openapi.json)、[生产网页脚本](https://pagepilot.chaoxi.live/app/assets/index.js)及[官方 Skill/CLI 包](https://pagepilot.chaoxi.live/skill/pagep.zip)：OpenAPI 声明 POST 发布和两个设置兼容别名，生产网页与 CLI 使用上述 POST 追加版本字段。这里的验证范围是公开资料的只读核查与 `scripts/test_publications.py` 的隔离 Mock 回归；没有对目标远端执行发布、更新或设置写入来证明其已验收，实际部署仍需另行授权验证。

#### 共享 Token 的数据隔离

PagePilot Token 是整个业务系统共享的服务凭证，远端站点列表包含所有用户。**「已发布」始终查询本地数据库，不能调用 PagePilot 全量列表后在前端过滤。** 即使未来接 PagePilot MCP，也不能直接向用户开放共享 Token 的 `list_sites`。

`publications.user_id` 来自业务 BFF 传入的可信 Token，经 Agent 的身份接口确认；接口不接受浏览器/模型传入的所有者 `user_id`。`session_id` 只用于记录来源和筛选，不决定归属，也不能作为更新权限证明。用户换新会话后仍能看到自己的发布记录。

更新时先检查当前用户拥有本地 `publication_id`，或当前 PagePilot 地址下属于该用户的 `code`；其他用户记录和本地未知的历史 `code` 一律拒绝。远端已经存在但没有本地归属的旧页面不会自动导入，也不能通过提供 URL 认领。更换 PagePilot Base URL 后，旧记录可以查看，但更新必须恢复对应的连接器地址。

每次发布尝试先写入 `publication_versions`，保留完整 HTML 内容快照、标题、说明、大小和状态，再保存远端返回的 URL/版本。后续更新增加内容版本，不覆盖历史 HTML。`publications` 保存当前页面索引，详情中可查历史尝试；失败记录不等同于远端已成功发布的版本。

删除会话、清空消息或默认 30 天的会话清理不会删除发布记录和 HTML 版本；`session_id` 没有级联删除约束。生产存储需将发布内容纳入备份、恢复、容量和独立保留策略，不能假设会话到期就会释放这部分空间。

#### BFF/API 接入

业务 BFF 对浏览器暴露以下同源接口，并将前缀 `/api/agent` 转成 Agent 服务端的 `/api`：

| 方法与 BFF 路径 | 返回/作用 |
|---|---|
| `GET /api/agent/pagepilot/publications` | 当前用户分页记录；查询参数 `q`、`session_id`、`limit=1..100`、`offset`；返回 `items/total/limit/offset`，列表不带 HTML |
| `GET /api/agent/pagepilot/publications/{publication_id}` | `{"publication": ...}`，包含当前 HTML 和 `versions` 摘要 |
| `GET /api/agent/pagepilot/publications/{publication_id}/versions/{version_id}` | `{"version": ...}`，包含该版本 HTML、URL、状态和错误 |
| `POST /api/agent/pagepilot/publish` | 新建或更新，返回本地 `publication_id`、URL、远端版本、状态与可能的警告 |

这四个接口均使用当前业务用户身份；读取接口不会请求 PagePilot。发布请求示例：

```json
{
  "html": "<!doctype html><html><head><title>日报</title></head><body>今日巡检正常</body></html>",
  "title": "设备日报",
  "description": "今日设备巡检结果",
  "filename": "index.html",
  "access_password": "",
  "visibility": "unlisted",
  "session_id": "s_current",
  "publication_id": 42
}
```

新建时省略 `publication_id`；`session_id` 可省略，提供时必须属于当前账号。更新优先传本地 `publication_id`；若同时传兼容的 `code`，必须和该记录一致。`visibility` 取 `public` 或 `unlisted`。UI/SDK 每次显式传入密码字符串，空字符串会清除密码；HTTP API 兼容旧客户端，省略或 `null` 在更新时保留原密码，新建时不设置密码，不能把“省略”当作“明确公开”。发布说明可留空，能够生成时可由 Agent 生成。

发布返回 `status=published` 表示内容与访问设置完成。`status=partial`、`ok=false`、`warning` 表示内容已经发布，但密码或可见范围设置失败；前端必须显示 URL 和警告，提醒核对访问保护，不能显示全部成功，也不能自动重试新建。内容请求失败保留本地 `failed` 尝试；服务中断后同样提示核对远端，避免重复创建。

#### 服务端 SDK

`PagePilotClient` 继承 `AgentAdminClient`，使用已认证的业务用户 Token 和内部服务密钥；它既不接收前端 `user_id`，也不把全局 PagePilot Token 发给浏览器。

```python
from webagent.sdk import PagePilotClient

client = PagePilotClient(
    agent_url="http://127.0.0.1:8010",
    business_url="http://127.0.0.1:8000",
    internal_secret=internal_service_secret,
)

page = client.list_publications(
    current_business_user_token, q="日报", limit=20, offset=0
)
publication = client.get_publication(current_business_user_token, publication_id=42)
version = client.get_version(
    current_business_user_token, publication_id=42, version_id=7
)
result = client.publish_html(
    current_business_user_token,
    html=updated_report_html,
    title="设备日报",
    description="更新今日巡检结果",
    access_password=user_selected_password,
    visibility=user_selected_visibility,
    publication_id=42,
    session_id=current_session_id,
)
```

方法约定：`list_publications()` 返回分页对象；`get_publication()` 返回包含 HTML/版本摘要的记录；`get_version()` 返回指定版本；`publish_html()` 强制显式提供 `access_password: str` 与 `visibility: str`，不会生成密码。上述变量来自业务服务的已认证请求与用户本轮选择，不能从模型参数推导用户身份。

对已有小程序 API，直接把该 SDK 放在业务服务端/BFF，或按上述 HTTP 契约转发即可，不必将业务接口改成 MCP。业务方继续负责登录态、Token 交换和最终 RBAC；共享 PagePilot Token 仅在 Agent 后端访问远端时使用。

## 4. 同源代理与前端嵌入

推荐业务系统实现：

```http
POST /api/agent/chat/stream
GET  /api/agent/chat/stream/{run_id}
GET  /api/agent/tools
GET  /api/agent/models
GET  /api/agent/assistants
POST /api/agent/approvals/{id}/approve
POST /api/agent/approvals/{id}/reject
```

业务 BFF 的职责：

1. 校验当前用户。
2. 把用户 Token 放进 `Authorization`。
3. 加内部服务密钥。
4. 转发 `Last-Event-ID`。
5. 对 SSE 响应使用 `StreamingResponse`，不要缓存或二次缓冲。

前端对话可以是：

- 业务后台内的独立页面。
- 右侧抽屉或 iframe。
- Web Component。
- 业务系统原生组件。

无论哪种，API Key、MCP 内部密钥和 Agent 服务地址都不应下发浏览器。

### 4.1 HTML、React 与移动端

`web/` 提供原生 HTML/JS 管理台；`frontend/` 提供独立 React + TypeScript 可复用聊天组件和真实登录、对话、发布/记录界面。二者使用相同 BFF/API 与业务身份。本轮没有把原生配置页全部迁成 React，集成方可以选择自己的前端技术栈；实际小程序仍需用小程序原生请求/SSE适配与组件实现相同交互。

接入组件时，发布列表和历史版本一律走本地发布接口；HTML 预览放在隔离容器内，模型生成的 HTML 不能取得父页面 Cookie、内部密钥或 PagePilot Token。移动弹层应遵循视口高度、独立内容滚动与安全区规则，不能直接使用固定桌面宽度。

### 4.2 录音转写协议与真实验证

语音入口 `POST /api/agent/transcribe` 接受音频 data URL，由服务端读取运行设置 `asr_model_id`；不允许浏览器传供应商 API Key。ASR 未配置时按钮关闭，不会自动拿主对话模型转写。`supports_transcription=true` 是能力声明，仍需配置与测试正确协议。

在模型 `extra_params` 中配置：

```json
{
  "_asr": {
    "protocol": "chat_audio",
    "endpoint": "/compatible-mode/v1/chat/completions",
    "data_format": "data_uri"
  }
}
```

`protocol` 支持 `auto`、`transcriptions`、`chat_audio`、`dashscope`；`endpoint` 和 `data_format` 可省略。上例端点仅演示供应商相对路径，使用网关时应按该网关实际路由填写，不能照搬到另一家。端点必须与供应商 Base URL 同源，跨域服务另建供应商。

| 协议 | 文件与请求结构 |
|---|---|
| `transcriptions` | multipart 文件到 Base URL + `/audio/transcriptions`；典型为 Whisper/OpenAI 转写 |
| `chat_audio` | Chat Completions `input_audio`；标准为 Base64+`format`，Qwen 默认 `data:audio/...;base64,...` |
| `dashscope` | 原生 `/api/v1/services/aigc/multimodal-generation/generation`；按模型家族选择 Qwen3-ASR 的 `audio` 或 Qwen-Audio-3.x 的 `input_audio` |
| 自动识别的实时模型 | `*-realtime*` 使用 WebSocket，当前录音文件入口明确报错，不改走文件转写假装可用 |

Chat Audio/原生适配在需要时调用系统 FFmpeg 将 WebM/Opus、OGG、MP4 转成单声道 16 kHz WAV。部署语音功能时安装 FFmpeg，确保它在 Agent 服务进程的 `PATH`；缺少转换器时返回错误，不会默默丢掉录音。音频只用于本次转写，不应把供应商凭证或私有聊天内容当测试样本。

后台 ASR 测试发送 1 秒静音，合法空转写可证明接口能处理请求，但不代表有声识别质量已验收；缺少识别字段的 JSON、401/404/400 或实时协议不匹配均不能报成功。本轮已配置网关的真实结果是：`qwen-audio-3.1-realtime-plus` 文件端点 404；其可发现的 `qwen-audio-3.0-asr-flash` 原生路由提示 `model ... is not allowed on this route`，Chat Audio 为 400。这是实际供应商路由限制，当前不能宣称语音已经真实可用。`scripts/test_asr_protocol.py` 覆盖协议、空文本、HTTP错误、超时、密钥脱敏和浏览器录音转换；最终需用目标供应商正确模型与用户同意的短录音做接入验收。

协议参考：[OpenAI Chat Audio](https://developers.openai.com/api/docs/guides/audio-chat-completions)、[Qwen3-ASR](https://help.aliyun.com/zh/model-studio/recording-file-recognition-qwen)、[Qwen-Audio 原生 ASR](https://help.aliyun.com/en/model-studio/qwen-audio-asr-http-api)、[Qwen 实时语音](https://help.aliyun.com/en/model-studio/qwen-audio-realtime-user-guides)。

### 4.3 推理开关与供应商参数

前端应从模型接口读取有效 `reasoning_efforts`、`reasoning_can_disable`，仅提供模型实际支持的设置。`off` 与 `none` 表示用户希望关闭深度推理，后端按模型协议处理：DeepSeek 混合模型 `thinking.type=disabled`，Qwen 混合模型 `enable_thinking=false`，声明支持标准关闭的模型 `reasoning_effort=none`。显式关闭在额外参数合并后应用，会覆盖默认开启设置。

固定推理模型如 DeepSeek-R1、`deepseek-reasoner`、QwQ、明确的 `*-thinking` 不承诺可关闭。未知代理不要仅凭支持 `reasoning_effort` 就认定支持 `none`；应由供应商元数据/测试确认。协议需要覆盖时可用：

```json
{"_reasoning": {"protocol": "thinking", "can_disable": false}}
```

`protocol` 可取 `auto`、`effort`、`thinking`、`enable_thinking`；`can_disable=false` 可禁止关闭。`_reasoning`、`_asr` 是框架配置，不进入模型正文；非标准供应商参数通过 SDK `extra_body` 发出。关闭推理不能保证低延迟：本轮真实 DeepSeek 请求已不返回思考内容，但上游仍耗时约 17 秒。

## 5. SSE 事件协议

请求：

```http
POST /api/agent/chat/stream
Accept: text/event-stream
Content-Type: application/json
```

请求体示例：

```json
{
  "message": "查看全部设备",
  "session_id": "s_xxx",
  "assistant_id": 1,
  "model_row_id": 11,
  "enabled_tools": ["list_devices"],
  "reasoning_effort": "medium",
  "approval_mode": "confirm",
  "attachments": []
}
```

`approval_mode` 可取 `confirm` 或 `full_access`。后者只跳过写/删工具的用户确认，不会改变账号权限、助手白名单、工具四态和业务 API RBAC；管理员可通过运行设置关闭。

响应头包含：

```http
Content-Type: text/event-stream
X-Run-Id: <run-id>
Cache-Control: no-cache
X-Accel-Buffering: no
```

每个事件：

```text
id: 42
event: tool.finished
data: {"tool":"list_devices","call_id":"call_1","status":"ok","summary":"查询设备：共 6 台"}

```

主要事件：

| 事件 | 关键字段 | 说明 |
|---|---|---|
| `run.started` | `model`, `provider`, `demo_mode`, `approval_mode`, `tools` | 本轮运行开始 |
| `context` | `budget_tokens`, `compressed`, `summarized_messages` | 上下文预算与压缩 |
| `thinking.delta` | `delta` | 供应商返回的思考增量；默认实时展示，落库由管理员设置控制 |
| `step.started` | `step`, `max_steps` | 第 N 轮推理 |
| `text.delta` | `delta` | 正文增量 |
| `tool.started` | `tool`, `call_id`, `arguments`, `risk` | 工具开始执行 |
| `tool.finished` | `status`, `summary`, `result_text` | 工具执行结果 |
| `tool.approval_required` | `id`, `tool`, `arguments`, `risk`, `summary` | 需要用户审批 |
| `retry` | `attempt`, `delay_ms`, `reason` | LLM 重试 |
| `model.fallback` | `from`, `to`, `reason` | 切换备用模型 |
| `usage` | `usage` | 本轮累计 token 与费用 |
| `session.title` | `title` | 自动生成或更新会话标题 |
| `run.completed` | `status`, `answer`, `session_usage`, `run` | 正常运行结束 |
| `run.failed` | `message`, `status_code` | 运行失败 |

客户端应：

- 用事件 ID 维护 `lastEventId`。
- 断线后请求 `GET /api/agent/chat/stream/{run_id}`，带 `Last-Event-ID`。
- 收到 `run.completed` 后结束本地流。
- 收到 `run.failed` 时展示服务端错误，不要无限重连。
- 默认在当前页面实时展示 `thinking.delta`，可展开查看；不要擅自存入浏览器长期存储。服务端默认 `store_reasoning=0`，只保存思考标记和用量；管理员设置为 `1` 后才保存后续思考原文，无法恢复此前未保存的数据。

## 6. 审批与权限变更

默认 `confirm` 模式下，写/删工具会返回 `tool.approval_required`，审批对象包含：

- 审批 ID、工具名、参数、风险等级、摘要、有效期。
- 用户、会话、助手、模型、工具运行记录。
- 待继续的消息历史和剩余工具调用。

审批记录落在 `pending_approvals` 表，服务重启后仍可处理。审批被点击时使用“pending → processing”的原子更新，因此重复点击不会重复执行。

恢复审批时会：

1. 重新校验当前用户。
2. 重新构建 Agent 上下文。
3. 重新检查工具权限、四态和助手白名单。
4. 使用当前用户 Token 执行工具。

审批不保存明文登录 Token。用户权限在审批等待期间被撤销时，批准会失败并要求重新发起。

如果用户选择 `full_access`，写/删工具不会生成 `tool.approval_required`，而是直接执行并继续返回 `tool.started` / `tool.finished`。这只是交互策略变化，Agent 仍使用同一个用户 Token，业务 API 仍做最终授权。

## 7. 业务系统删除用户时的预留接口

当前 Demo 不自动删除 Agent 侧会话和审计。接入真实系统时，建议由业务系统在删除/停用用户后调用一个内部清理钩子，具体策略按合规要求决定。

预留契约：

```http
POST /internal/webagent/users/{user_id}/deleted
X-Internal-Token: <service-secret>
Content-Type: application/json

{
  "mode": "retain_anonymized",
  "requested_by": "admin",
  "reason": "employee_offboarded"
}
```

`mode` 建议支持：

| 模式 | 行为 |
|---|---|
| `retain` | 保留会话和审计，用于取证 |
| `retain_anonymized` | 保留统计和审计，正文/工具参数匿名化 |
| `delete_content` | 删除会话正文、附件、工具结果，保留最小审计 |
| `delete_all` | 删除会话与 Agent 业务数据，按法规保留不可变审计 |

实现时必须：

- 幂等，重复调用不报错。
- 写审计。
- 不删除审批中仍在执行的工具记录，先标记用户禁用。
- 不通过浏览器调用，只允许业务 BFF 使用内部密钥调用。

在正式接口确定前，业务系统应先把用户标记为不可用，并在 Agent 侧禁用其新会话和工具调用。

## 8. 暂不实现：soul.md、AGENTS.md 与租户知识库

当前版本不实现以下能力：

- 每个助手挂载 `soul.md`、`AGENTS.md` 等人格/行为文件。
- 租户自行上传知识库文档。
- 租户级文档隔离、Embedding、重排和检索。

当前等价能力：

| 目标 | 当前做法 |
|---|---|
| 助手人格与边界 | 管理员的「助手 → 系统提示词」 |
| 行为规范与流程知识 | Skill 的 `SKILL.md` 正文 + 参考文件，渐进式加载 |
| 业务实时数据 | Tool / MCP / 动态 HTTP 工具 |
| 用户长期偏好 | 手动维护的用户记忆 |

不建议现在“顺手做一个知识库上传”，因为它会同时引入：

- 文件存储、病毒扫描、格式解析和沙箱。
- 文档 ACL、租户隔离、删除传播和备份。
- 分块、Embedding、向量库、重排、引用溯源。
- 检索内容进入模型后的提示注入防护。
- 知识库更新、索引版本和评测。

后续如果要做，建议单独设计“租户知识库”域：

```text
tenant_id
  -> knowledge_base
      -> document
          -> chunk / embedding
          -> ACL
      -> retrieval_tool
          -> 引用与审计
```

知识库应通过独立工具接入 Agent，而不是把全文直接塞进 system prompt。知识库工具返回的文档内容必须视为不可信数据，不能执行其中的指令。

## 9. 接入验收清单

- [ ] 业务 `/api/me` 返回稳定用户 ID、角色和 action code。
- [ ] Agent 代理要求内部密钥，浏览器不能直连 Agent。
- [ ] 每个工具都有权限、风险和 JSON Schema。
- [ ] 工具执行使用当前用户 Token。
- [ ] 写/删工具产生审批，批准后业务 API 再次鉴权。
- [ ] 重复审批、跨用户审批、过期审批都被拒绝。
- [ ] 管理员停用工具后，用户侧和 Agent 运行时都不可用。
- [ ] 用户取消勾选后，本轮不会调用该工具。
- [ ] 普通用户不能读取他人会话或恢复他人 SSE 流。
- [ ] SSE 能收到工具事件，并以 `run.completed` 结束。
- [ ] 断线后能按 `Last-Event-ID` 恢复。
- [ ] 供应商 API Key 不在浏览器、日志和工具上下文中出现。
- [ ] 业务系统和 Agent 都记录审计。
