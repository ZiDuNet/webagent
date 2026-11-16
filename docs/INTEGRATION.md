# 业务系统接入手册

## 1. 先确定边界

目标是复用业务系统的身份与服务，而不是再做一套用户权限系统。

- 管理端维护框架资源，始终使用独立 `control_users` 登录，或使用单独签发的管理 Token。
- Chat 用户来自业务系统；后端用 `IdentityAdapter` 验证当前会话 / Token。
- Tool 只是能力契约，执行可以是原生函数、HTTP 或 MCP，不要求业务 API 包装成 MCP。
- 会话归属使用稳定 `subject + namespace`，不要求业务系统提供数字主键。
- 对象权限、租户范围、数据脱敏和字段权限由业务服务最终实施。
- 提示词、Skill、BM25 和决策模型都不能授予权限。

Node 系统可同进程嵌入，其他语言可保留现有业务后端，通过同源代理与 HTTP / MCP 接入。SSO 不是必需条件；仅在确实需要跨系统登录时再做认证适配。

## 2. 后端嵌入与原生 Tool

`server/src/sdk.ts` 导出 `createWebAgent`、`ToolSpec`、`IdentityAdapter` 等。workspace 构建后从 `@webagent/server` 导入；当前服务包为内部包，跨仓库使用应先按组织要求打包或引用，不声称已发布到公共 npm。

以下 `businessSessions` 与 `recordService` 是宿主项目自己的现有服务：

```ts
import { createWebAgent, type IdentityAdapter, type ToolSpec } from "@webagent/server";
import { businessSessions, recordService } from "./business-services.js";

const identityAdapter: IdentityAdapter = {
  resolve: async (credential) => {
    const current = await businessSessions.resolve(credential);
    if (!current) return null;
    return {
      subject: current.userUuid,
      namespace: current.tenantKey,
      username: current.username,
      display_name: current.displayName,
      role: current.role,
      permissions: current.permissions,
      is_admin: current.isBusinessAdmin,
    };
  },
};

const listRecords: ToolSpec = {
  name: "business_list_records",
  title: "查询业务记录",
  description: "查询当前业务用户数据范围内的业务记录，可按关键词筛选。",
  category: "业务记录",
  source: "native",
  permission: "record:read",
  risk: "read",
  parameters: {
    type: "object",
    properties: { keyword: { type: "string" } },
    additionalProperties: false,
  },
  execute: async (args, context) => recordService.listForUser({
    userId: context.identity.subject,
    credential: context.credential,
    keyword: args.keyword,
    signal: context.signal,
  }),
};

const service = await createWebAgent({
  identityAdapter,
  tools: [listRecords],
  staticUi: false,
});
await service.app.listen({ host: "127.0.0.1", port: 8000 });
```

`createWebAgent()` 返回 Fastify 实例和运行服务，可在同一进程注册额外业务路由；不必另起 PI 子进程或 ACP 服务。若已有其他 HTTP 框架，使用内部端口反向代理通常比强行迁移业务框架更稳妥。

### 身份适配约定

| 字段 | 约定 |
| --- | --- |
| `subject` | 业务系统内稳定、唯一的身份标识，如 UUID / 不可变用户主键；用户名改名不能改变归属 |
| `namespace` | 可选业务域 / 租户前缀，与 `subject` 共同组成 `owner_key` |
| `id` | 可选数字 ID，仅为 Demo 与旧数据兼容；没有时不要伪造 |
| `username` | 展示与审计用，不作为授权唯一键 |
| `role` | 用于助手角色范围，不替代权限码 |
| `permissions` | 当前真实业务权限码数组，权限变更后应立即反映 |
| `is_admin` | 业务属性，不放行管理 API |

适配器只需要返回稳定的 `subject`；不同业务或租户的 `subject` 可能重号时，填 `namespace` 形成 `namespace:subject` 的 `owner_key`。`namespace` 现在隔离会话、记忆、发布与运行归属，但不等于完整的多租户管理隔离：管理员账号、模型、工具和全局设置仍是单控制面。真正的租户级管理面、配额和密钥隔离需要后续扩展，不能只添加前端 `tenant_id` 就宣称支持。

如果适配器既没有 `subject` 也没有 `id`，框架会用当前登录凭据摘要做降级归属。这样不会串号，但 Token 轮换后会看不到旧会话，Web 与小程序也无法共享；正式接入应始终返回稳定 `subject`。

### 跨端会话与稳定身份

会话列表不按「浏览器 / 小程序 / 设备」区分，而是按 `IdentityAdapter.resolve()` 返回的稳定 `subject + namespace` 生成的 `owner_key` 归属。Web 和小程序可以各自持有不同的业务 Token，只要两个 Token 都解析到同一个 `owner_key`，就会看到同一份 `/api/agent/sessions` 列表。

```ts
return {
  subject: current.userUuid,    // 不能使用可修改的用户名、手机号或 Token
  namespace: current.tenantKey, // 单租户系统可省略
  username: current.username,
  display_name: current.displayName,
  role: current.role,
  permissions: current.permissions,
  is_admin: current.isBusinessAdmin,
};
```

同一用户在不同端打开同一会话时，后端仍然只允许一个运行任务；另一个端可通过会话详情里的 `active_run` 发现并订阅当前任务，或等任务结束再发送消息。不要用「每个端新建一个会话」来规避运行锁，否则历史会被拆散。

如果业务系统只能提供可变化的账号名，应在宿主维护 `account -> stable_subject` 的持久映射表，并保证 Web、小程序、后台使用同一映射；不要在不同端各自生成随机 ID，也不要把 Token 原文当业务 `subject`。

每次工具执行前重新 `resolve()`，还会读取工具启用状态、权限码及助手白名单。Tool 的 `execute()` 仍必须复用原服务的行级 / 租户权限检查；不要直接相信模型传入的 `user_id`、`tenant_id` 或资源 ID。

### 写入与取消

写入 Tool 使用 `risk: "write"`，删除用 `"delete"`。确认模式下先生成审批卡，实际函数尚未执行。用户确认后重新鉴权、一次性执行，再把真实结果交回 PI。审批不能重复消费，过期或权限变化时拒绝。

允许的完全访问模式只跳过业务写入确认，不绕过业务授权。连接器应传播 `AbortSignal`；取消不代表回滚已提交操作。写入接口建议业务自身提供幂等键与查询操作状态，不自动重试具有副作用的工具。

原生函数只允许开发者在代码中注册。后台不支持上传 JS / npm 包执行，也不开放通用 Shell。小程序、桌面端或已有 BFF 已经有完整数据接口时，优先在 Node 宿主写 `ToolSpec` 调这些服务，而不是为了「统一」再包一层 MCP；只要 `execute()` 复用原接口的用户鉴权和数据范围，Agent 就继承同一权限边界。

### 直接写 Tool，不经过 MCP

```ts
const listOrders: ToolSpec = {
  name: "mini_program_list_orders",
  title: "查询我的订单",
  description: "查询当前登录用户在小程序中的订单，可按状态筛选。",
  category: "订单",
  source: "native",
  permission: "order:read",
  risk: "read",
  parameters: {
    type: "object",
    properties: { status: { type: "string", enum: ["paid", "shipped", "done"] } },
    additionalProperties: false,
  },
  execute: async (args, context) =>
    orderService.list({
      token: context.credential,
      subject: context.identity.subject,
      status: args.status,
      signal: context.signal,
    }),
};
```

这条路径没有 MCP 进程、没有额外网络跳转，也不会把业务 Token 交给第三方；模型只看到工具描述与 Schema，真正权限仍由 `orderService` 判断。MCP 适合复用外部现成能力或跨语言服务，不是所有业务接入的必选项。

## 3. 前端 SDK

`sdk/` 提供 `@webagent/sdk`，使用标准 fetch / Response / ReadableStream，支持每次请求动态取得 Token：

```ts
import { WebAgentClient } from "@webagent/sdk";
import { getBusinessAccessToken } from "./auth.js";

const agent = new WebAgentClient({ token: getBusinessAccessToken });
const { session } = await agent.createSession({ title: "记录检查" });

let runId = "";
let cursor = "";
for await (const event of agent.stream({
  session_id: session.id,
  message: "查询当前可用的业务记录",
  approval_mode: "confirm",
})) {
  if (event.id) cursor = event.id;
  if (event.name === "run.started") runId = String(event.data.run_id);
  if (event.name === "text.delta") console.log(event.data.delta);
}

for await (const event of agent.resume(runId, cursor)) {
  console.log(event.name, event.data);
}
```

示例中的 `resume()` 用于真实断线后的恢复，正常完成不必再调用。主动停止是 `agent.cancel(runId)`，`AbortController.abort()` 只断开本次浏览器请求，不停止后台。

SDK 还包含 `me`、`status`、`models`、`assistants`、`tools`、`sessions`、`messages`、`forkSession`、`deleteSession`、`compact`、`approve`、`reject`、`memories`、`publications`。未封装的 REST 可通过 `json()` 调用。

React 组件见 `chat/src/index.ts`。Chat 样式依赖主题 CSS；在宿主复用时同时引入组件样式与 theme，避免复制旧 HTML 应用。默认 Chat Demo 使用自身业务登录；宿主应替换登录 UI 和 API 身份获取，而不是把业务 Token 放在 URL 查询串。

### 小程序接入

本版 Chat 是移动 Web 参考，并非原生微信小程序。小程序需实现自己的组件与网络适配：

- `wx.request` 普通 JSON 请求可包装为自定义 fetch，但 SSE 必须启用分块接收并实现 `ReadableStream` / Response 兼容。
- 如果运行环境无 Web Streams，单独解析 `onChunkReceived`，保留 SSE UTF-8 / CRLF 跨包边界与事件 ID。
- 小程序 Token 仍由自己的登录系统产生，不用框架管理账号。
- 模型 / 工具 / 记忆 / 审批沿用同一 API；Markdown / Mermaid / HTML 预览需使用适合小程序的组件或受控 WebView。
- 无法持续连接时保存 run_id，恢复前台后查询会话 `active_run`，重新订阅；切后台不自动取消运行。

不把 SDK 可注入 fetch 等同于无需适配即可在任意小程序直接运行。

## 4. HTTP 工具

管理端「工具与连接器 → HTTP API」新增：

- 唯一英文 `name`、说明、输入 JSON Schema。
- HTTP 方法、完整可信 URL、权限码、风险。
- URL 路径变量使用 `{record_id}`，其余参数以 query 或 JSON 传递。
- 后端始终注入当前业务 `Authorization: Bearer ...`，模型不能传入或覆盖。
- 附加请求头支持 `${user.id}`、`${session.id}`，禁止覆盖 Authorization、Cookie、Host 等身份 / 传输字段。

```json
{
  "name": "business_record_detail",
  "display_name": "记录详情",
  "description": "查询当前用户可访问的一条业务记录",
  "permission": "record:read",
  "risk": "read",
  "method": "GET",
  "url_template": "https://business.example/api/records/{record_id}",
  "headers": { "X-Agent-Session": "${session.id}" },
  "input_schema": {
    "type": "object",
    "properties": { "record_id": { "type": "integer", "minimum": 1 } },
    "required": ["record_id"]
  }
}
```

保存位置：HTTP 连接器为 `data/tools/http/<name>.json`，MCP 为 `data/tools/mcp/<name>.json`，四态策略与标签在 `data/tools/policies.json`。三者都是纯 JSON，可直接用编辑器或部署脚本维护，不需要改数据库；配置文件不是合法 JSON 时服务会明确报错而不是覆盖它。

这是面向受信任业务 API 的轻量连接器，不是万能 OpenAPI 编排器。第三方服务密钥优先放 MCP 加密凭据或开发原生适配器，不能把业务 Token 转发给不可信网站。目标 API 必须最终校验用户数据权限，不能只依据 `X-Agent-*` 请求头信任身份。

## 5. MCP 三种传输

使用官方 `@modelcontextprotocol/sdk` 客户端：

| 类型 | 配置 | 注意 |
| --- | --- | --- |
| Streamable HTTP | `url`、可选加密 headers | 推荐新 MCP 服务 |
| SSE | `url`、可选加密 headers | 兼容旧服务 |
| stdio | `command`、字符串 `args`、加密 env | 默认禁用；部署者配置允许后才启动 |

管理端支持表单和标准 `mcpServers` JSON 批量导入，导入不调用远端、不默认开放工具：

```json
{
  "mcpServers": {
    "业务 MCP": {
      "type": "streamable-http",
      "url": "https://business.example/mcp",
      "headers": { "Authorization": "Bearer replace-locally" },
      "tool_policies": {
        "record_search": { "permission": "record:read", "risk": "read" },
        "record_update": { "permission": "record:update", "risk": "write" }
      }
    },
    "本地 MCP": {
      "command": "node",
      "args": ["/opt/trusted-mcp/server.js"],
      "env": { "SERVICE_TOKEN": "replace-locally" }
    }
  }
}
```

导入后点「测试 / 同步」拉取工具，再确认权限映射。未知工具默认不开放；明确允许所有登录业务用户的基础只读能力可设 `public: true, risk: "read"`。外部服务描述中的 `[META]permission=...;risk=...[/META]` 可作映射来源，显式后台映射优先；只连接信任的 MCP 服务。

`forward_user_token` 只用于受信任业务 MCP，将当前业务 Token 注入请求头；第三方 MCP 一般用自己的服务 Token。JSON 中 `$ENV` 按字面保存，不自动读取服务器环境变量。MCP 输出是数据，不能改变权限或运行规则。

共享 PagePilot Token 若直接交给通用 MCP，不会自动得到框架本地发布归属保护；需要按下一节使用专用连接器或自行开发用户归属适配。

## 6. PagePilot 发布连接器

内置 Tool `pagepilot_publish_html` 与 `pagepilot_list_my_pages`，后台配置地址 / Token；未配置时发布 Tool 不提供给 PI。

- 每条发布记录以稳定 `owner_key`（`namespace:subject`）归属，而非仅以 session 区分；session 只是可选来源信息。
- 本地保存 HTML、版本、返回 URL 和远端 code，不调用共享 Token 的全量列表来展示「我的页面」。
- 更新必须使用当前用户本地归属记录，禁止用户凭远端 code 更新别人的页面。
- 用户选择标题、可见范围与密码；密码可为空，不自动生成。标题可拼接后台后缀。
- Agent 调用要先询问是否加密码；Schema 要求显式 `access_password`，空字符串代表用户明确不设。
- 工具中的密码字段对过程、PI 条目、审计脱敏，实际审批参数加密保存。用户主动在普通聊天正文里输入的密码不属于工具字段脱敏保证，建议通过专门发布表单输入敏感信息。
- 内容已经发布而密码 / 可见范围更新失败时返回 `partial`，保留 URL 和告警，避免盲目重试产生重复页面。

远端协议：`POST /api/deploy`，更新用 `customCode` / `createVersion`，密码和可见范围走 deploy 元信息端点。PagePilot 版本不同时需在 `publications.ts` 适配，并在隔离环境验证，不能只通过 Token 测试就认定发布功能全部兼容。

## 7. Skill 与知识库

Skill 以后端 `data/skills/` 为唯一事实来源，每个目录包含 `SKILL.md`、可选文本参考文件和 `.webagent-skill.json` 启停元数据，正文不写入数据库。管理端可全局开关，也可逐项启停；助手通过 `skill_slugs` 选择可用 Skill，留空表示继承全局已启用的 Skill。

运行时按助手物化到 `data/runtime/skill-runtime/`，模型先看到名称与描述，需要时通过 PI 原生 `read` 读取 `SKILL.md` 和文本参考文件。参考文件仅 `.md/.txt/.json/.yaml/.yml/.csv`，读取被限制在物化目录内，不允许路径穿越、符号链接、二进制或脚本执行。仅有目录访问权限不等于获得业务权限，Skill 不能提升工具或数据授权。

此分支不自动读取业务项目中的 AGENTS.md / SOUL.md，也不执行任意插件。系统角色规则通过助手提示词配置，业务 SOP 适合用 Skill；需脚本时开发有明确权限的原生 Tool 或隔离服务。管理端支持导入 Skill ZIP / 目录，但只提取受支持的文本参考文件，不执行其中的脚本。迁移旧数据库 Skill 时会先写 `.legacy-skills.json` 备份，迁移完成后再移除旧表。

租户自建知识库、PDF 解析、向量存储暂不落地。RAGFlow、IMA 等可作为 MCP 或原生检索 Tool 接入；检索前必须按当前业务身份过滤文档范围，检索结果属于不可信数据。

## 8. 管理端嵌入与 Token

管理端始终有独立的 `control_users` 与登录 Cookie，业务系统身份不会自动获得管理权限。若把 `admin/dist` 部署在业务系统、独立管理域名或跨域页面，可以签发管理端 Token：

1. 在「接入与安全 → 管理端 Token」创建，填写名称、过期时间与允许来源。
2. 打开管理端登录页，选择「使用管理 Token 连接」。
3. 同源部署留空 API 地址；跨域部署填写 `https://your-host/api/control`。
4. 跨域时把管理端所在 Origin 加入 Token 白名单；留空时浏览器只允许同源使用。

管理 Token 只能调用 `/api/control`，不能调用 `/api/agent`，也不能替代业务 Token。原始 Token 只显示一次，数据库只保存哈希；轮换后旧 Token 立即失效。生产环境必须使用 HTTPS，不要把 Token 放进 URL、日志、截图或前端构建变量。

管理端 API：

| API | 作用 |
| --- | --- |
| `GET /api/control/admin/control-tokens` | 列出管理 Token（不含哈希） |
| `POST /api/control/admin/control-tokens` | 创建并只返回一次原始 Token |
| `PUT /api/control/admin/control-tokens/:id` | 修改名称、启用状态、过期时间和来源 |
| `POST /api/control/admin/control-tokens/:id/rotate` | 轮换 Token，旧值立即失效 |
| `DELETE /api/control/admin/control-tokens/:id` | 删除 Token |

跨域直连需要代理或后端返回的 CORS 头，并正确转发 `Authorization: Bearer ...`。仍然推荐由业务网关同源反向代理 `/api/control`，这样管理 Cookie 与 Token 两种方式都能工作。

## 9. 主要 API 与事件

| API | 作用 |
| --- | --- |
| `GET /api/me` | 当前业务身份 |
| `GET /api/agent/models` / `assistants` / `tools` | 当前可选模型、助手和工具；`tools` 返回可见选择项及隐藏固定启用数量 |
| `POST /api/agent/sessions` | 创建默认或指定助手会话 |
| `GET /api/agent/sessions/:id/messages` | 消息与 active_run |
| `POST /api/agent/chat/stream` | 创建后台任务并订阅 SSE |
| `GET /api/agent/chat/stream/:runId` | 按 Last-Event-ID 重连 |
| `POST /api/agent/runs/:id/cancel` | 取消后台任务 |
| `POST /api/agent/approvals/:id/approve` / `reject` | 用户确认 / 拒绝 |
| `POST /api/agent/questions/:id/answer` | 回答 `ask_user` 交互问题；支持选项、补充文本和取消 |
| `WS /api/agent/voice/stream?session_id=...` | 当前会话绑定的实时语音通话；ASR / TTS 未配置或会话运行中时拒绝 |
| `POST /api/agent/transcribe` | 普通文件 STT；识别结果由前端回填输入框，默认不自动发送 |
| `WS /api/agent/voice/dictate?session_id=...` | 输入框实时听写；partial / final 回填，不创建额外会话 |
| `POST /api/agent/audio/speech` | 普通 TTS 合成；正式 Chat 已在右上角提供朗读入口，业务前端也可复用 |
| `POST /api/agent/sessions/:id/compact` | 手动压缩 |
| `POST /api/agent/sessions/:id/fork` | 分叉会话 |
| `PATCH /api/agent/sessions/:id/messages/:messageId` | 编辑并删除后续上下文 |
| `DELETE /api/agent/sessions/:id/messages/:messageId` | 删除该消息及后续消息 |

主要 SSE 名称：`run.started`、`run.phase`、`decision.completed`、`step.started`、`thinking.delta`、`text.delta`、`answer.completed`、`tool.args.delta`、`tool.started`、`tool.finished`、`tool.approval_required`、`question.required`、`retry`、`usage`、`session.title`、`run.completed`、`run.failed`。

`answer.completed` 表示回答正文已经生成完毕，可以结束 Markdown / HTML 渲染、展示复制等只读操作，也可以开始 TTS；此时后台可能仍在自动压缩上下文，`run.completed` 尚未到达，因此下一轮输入应继续禁用。`run.completed` 才表示整个运行（含压缩、落库和辅助任务）结束。

思考是供应商实际返回的可见 reasoning 字段，不会凭空生成模型内部思维。`tool.args.delta` 不发送未完成敏感参数。决策原始 IO 只给独立管理端的短期诊断，不推送给业务 Chat。

`question.required` 与 `tool.approval_required` 语义不同：前者只是模型缺少信息，用户回答后继续原任务；后者是危险操作尚未执行，必须由用户明确确认。前端不要复用审批样式或自动替用户回答。问题在刷新后仍为 pending 时，消息元数据会带上问题对象；已过期或已被新消息取代的问题不能继续提交。

## 10. 接入验收清单

1. 业务管理员不能登录控制面，控制面登录不能查询业务数据。
2. 低权限用户在直接 API、聊天工具、审批续跑、分叉历史中均不能越权。
3. 用户切换 / Token 撤销 / 助手白名单或工具权限修改后，执行前实时生效。
4. 关闭页面后任务继续；停止按钮真的取消后台；重启不重放修改和发布。
5. 模型未配置、MCP 超时、业务失败、发布 partial 明确显示，不伪造成功。
6. 同模型调用输出 Markdown / Mermaid / HTML 时，桌面与移动端不阻塞流式输出。
7. 密钥不出现在前端包、URL、日志、截图与 git；用户原文的敏感数据由业务数据策略治理。
