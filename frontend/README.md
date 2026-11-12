# WebAgent React 组件与业务接入

React + TypeScript + Vite。组件沿用正式 HTML 系统的深色配色、绿色强调色 `#27c96a` 和输入框布局。聊天弹层采用 Radix Dialog，模型管理采用 Ant Design 6 与 Lucide 图标；手机端调整尺寸、内容滚动和触摸目标。

`src/App.tsx` 连接真实业务服务：登录、会话、模型、工具、流式聊天、语音识别、HTML 发布和发布记录。旧的模拟回答数据与会话 Hook 已移除，不自动播放假回答，也不把未完成操作显示为成功。

## 启动

先在项目根目录启动业务服务，再运行：

```bash
cd frontend
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。开发代理将 `/api/**` 转发到 `http://127.0.0.1:8000`，所有请求携带同源业务 Cookie；无需给 React 配置全局 PagePilot Token 或 LLM API Key。登录使用业务系统的账号。未登录时展示真实登录表单，接口不可用时显示错误。

```bash
npm run build
npm run preview
```

`npm run build` 还将锁定版本的 Markdown/KaTeX/Mermaid 资源复制到根目录 `web/vendor`，供正式 HTML 离线加载。本地业务服务与 Compose 都在同源 `/react/` 挂载构建结果（业务服务需在构建后启动），根入口 `/` 默认跳转到 React。`preview` 只验证静态构建；独立部署需由业务域名反向代理承接 `/api/**`。业务鉴权、工具调用授权和发布记录所有者校验均在后端执行，不要把客户端过滤当成权限校验。开发时配置入口默认到 `http://127.0.0.1:8000/admin/`，可用 `VITE_BUSINESS_URL` 覆盖；生产使用同源 `/admin/`，不再打开第二个聊天首页。

## 流式过程与等待反馈

过程默认只占一行，按时间顺序连续播放实际步骤、思考原文、工具参数/结果与回答片段。长文本按标点或最多 36 个 Unicode 字符分段；超过单行宽度时平移，积压时加快播放，避免固定显示“等待模型响应”或只轮换阶段名称。点击展开对应轮次的完整内容；完成后立即停止播放、自动收起，当前页面仍可重新展开未落库的本轮思考。

- `run.phase`：真实的身份校验、工具发现授权、上下文检查和按需压缩，不伪造模型推理。
- `step.started`：等待模型首次响应或等待模型继续；追加真实请求提示，不把轮次编号作为播放主体。
- `thinking.delta`：逐段加入上方单行播放，完整正文保留在当前轮对应的位置。
- `tool.args.delta`：仅显示模型正在生成调用参数，不显示未脱敏的参数片段。`tool.started` 后显示后端处理过的参数。
- `tool.started` / `tool.finished`：动作、后端已脱敏参数和实际结果都进入播放队列；原始调用参数碎片始终不展示。
- `text.delta`：同步加入过程播放并立即增量解析 Markdown；HTML 在过程行播放源码片段，正文继续使用紧凑产物卡；20fps 合批，心跳和工具参数碎片不触发整屏更新。
- `run.completed`：冻结计时、收起过程；同步数据库消息时保留消息渲染身份，避免重新播放入场动画。审批与错误不能显示成成功。

支持暂停、上一条/下一条，悬停与键盘聚焦暂停；手机端只保留 44px 的暂停按钮并可展开查看全部过程。`prefers-reduced-motion` 关闭自动播放动画，改为直接跟随最新内容。队列最多保留 300 段且仅在内存中存在，完整思考的落库规则由后端配置决定；播放进度和计时不触发整个聊天正文重新解析。可复用数据类型 `ProcessActivity` 与 `ProcessData.activities` 从组件入口导出。

参考的是 Octop 的阶段提示、折叠过程与完成后收起的交互原则，不移植其多 Agent/团队执行逻辑。组件不会缩短上游模型实际首 token 等待时间；需要分开观察准备、模型请求与工具执行耗时。

过程状态回归（Node.js 22.6+，推荐 22.18+）：

```bash
npm run test:conversation
```

## 可复用组件

统一导出位于 `src/index.ts`，样式入口为 `src/styles/theme.css`。

| 组件 | 用途 |
| --- | --- |
| `Composer` | 图片、语音、四态工具选择、执行方式、模型、推理等级和输入框下方的上下文进度 |
| `MessageList` | Markdown、工具过程、审批、HTML 产物和本次用量 |
| `Markdown` | markdown-it 解析；支持表格、代码、KaTeX 和按需 Mermaid |
| `DataChart` | 安全 JSON 图表：柱状、折线、面积、饼/环形与可展开数据表 |
| `CodeBox` | 可滚动代码、复制、下载、换行与行号 |
| `ProcessLine` | 一行活动状态、可展开工具和思考、完成后折叠 |
| `HtmlArtifactCard` | 本地隔离预览、代码、保存图片、发布和已发布入口 |
| `ApprovalCard` | 工具操作确认；操作结果由宿主处理 |
| `SessionList` / `MessageActions` | 会话与消息的重命名、分叉、编辑、删除和用量 |
| `PublishedPages` | 当前业务账号的发布列表、搜索、会话筛选、版本、预览和更新 |
| `PublishPageDialog` | 新建或更新页面，每次填写密码、选择可见范围 |
| `ModelsSettings` | 对话 / 语音 / 生图 / 决策模型池、多供应商连接、参数同步、真实分类测试 |

组件通过 props 和回调融合现有系统。`HtmlArtifactCard` 默认仅呈现紧凑标题卡和「打开预览 / 查看代码」，点击才打开弹窗和加载 iframe；弹窗内保留下载、截图、发布与已发布记录入口。`HtmlArtifactCard.onAction` 支持异步回调，失败时显示真实错误；未传回调时发布/保存按钮禁用，不模拟成功。App 的截图操作连接 `/api/agent/artifacts/screenshot`。

## 模型管理组件

生产入口 `/react/?view=models`，HTML 后台模型菜单内嵌 `/react/?view=models&embed=1`；两者使用同一组件和登录态。页面先检查管理员身份，所有模型与供应商写接口仍由后端核验管理员权限。

```tsx
import { ModelsSettings } from "./src";
import "./src/styles/theme.css";

export function AdminModels() {
  return <ModelsSettings
    baseUrl="/api/agent"
    initialCategory="chat"
    onChanged={() => window.dispatchEvent(new Event("models-changed"))}
  />;
}
```

`initialCategory` 支持 `chat | voice | image | decision`；`baseUrl` 指向同源 BFF，不携带服务密钥。`onChanged` 通知宿主刷新模型可选列表。组件自带局部 Ant Design 深色主题，外层应提供可滚动的视口容器；官方嵌入页固定剩余视口高度，弹窗正文独立滚动、保存按钮保留在底部。

模型列表不在打开页面时自动拉取供应商目录；只有管理员点击后才访问 `/models` 或 models.dev。可手输 ID，读取有 12 秒超时和取消按钮。12 个品牌模板不代表已适配所有厂商原生协议，边界见 [模型接入手册](../docs/MODELS.md)。

语音页独立设置 STT 和 TTS 默认绑定；支持上传 / 录制测试音频和 TTS 合成试听。`POST /api/agent/audio/speech` 返回音频二进制，业务界面可用 Blob URL 接入播放；当前聊天页未自动朗读回答。实时 WebSocket 语音仍预留。

## 发布记录接入

```tsx
import { useState } from "react";
import { PagePilotClient, PublishedPages, PublishPageDialog } from "./src";
import "./src/styles/theme.css";

const client = new PagePilotClient({ baseUrl: "/api/agent" });

export function ReportActions({ html, sessionId }: { html: string; sessionId?: string }) {
  const [publishedOpen, setPublishedOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  return <>
    <button onClick={() => setPublishOpen(true)}>发布报告</button>
    <button onClick={() => setPublishedOpen(true)}>已发布</button>
    <PublishPageDialog
      open={publishOpen}
      onOpenChange={setPublishOpen}
      html={html}
      title="今日运维报告"
      sessionId={sessionId}
      client={client}
    />
    <PublishedPages
      open={publishedOpen}
      onOpenChange={setPublishedOpen}
      currentSessionId={sessionId}
      currentHtml={html}
      client={client}
    />
  </>;
}
```

`PagePilotClient` 还支持注入 `fetcher`，以便现有业务系统增加自己的请求头、CSRF 头或网关封装。实例应保持稳定，不要在每次渲染中重新创建。默认 `credentials: "same-origin"`；不要将全局 PagePilot 密钥放入浏览器。

### 组件与数据

`PublishedPages` 接收：

- `open` / `onOpenChange`：受控弹窗。
- `currentSessionId`：标识当前会话，供来源筛选和新版本关联。
- `sessions: {id,title}[]`：可选，只用于会话标题与筛选下拉。
- `currentHtml`：可选。有值时在页面详情显示「用当前 HTML 更新」；无值仍可重新发布已有本地存档。
- `onOpenSession`：可选。用户点击来源会话时交还宿主导航。
- `onPublished`：后端返回发布结果后通知宿主。`status="partial"` 表示内容或设置仅部分完成，不能按完整成功处理。
- `client`：可选，默认使用同源 `/api/agent`。

`usePublishedPages({ client, enabled, query, sessionId, limit })` 提供 `items`、`total`、`loading`、`loadingMore`、`error`、`refresh()` 和 `loadMore()`。切换条件和关闭组件会终止过期查询，旧响应不会覆盖新的筛选结果。列表支持分页，输入搜索采用 250ms 防抖。

### 本地记录与共享 Token

服务端按登录用户 `user_id` 保存和查询记录，`session_id` 只是来源关联。用户即便新建/删除会话，也不能通过传入其他用户的 `publication_id` 或 PagePilot `code` 更新他人的内容。前端没有远端列表接口，列表、详情和历史版本全部读取业务系统本地记录。

| 方法 | 业务接口 | 内容 |
| --- | --- | --- |
| `list()` | `GET /api/agent/pagepilot/publications?q=&session_id=&limit=50&offset=0` | 当前用户的本地列表，不返回 HTML、密码或 Token |
| `get(id)` | `GET /api/agent/pagepilot/publications/{id}` | 所有者可读的 HTML 与版本摘要 |
| `getVersion(id, versionId)` | `GET /api/agent/pagepilot/publications/{id}/versions/{versionId}` | 本地历史版本 HTML |
| `publish(input)` | `POST /api/agent/pagepilot/publish` | 新建；携带 `publication_id`、`code` 时更新已有页面 |

发布输入为 `{ html, title, description?, access_password, visibility, session_id?, publication_id?, code? }`。不在客户端传 `user_id`，用户身份只能由服务端登录态确定。状态可能是 `publishing`、`published`、`partial`、`failed`。

每次打开发布/更新表单，密码都为空、可见范围要求重新选择。密码可留空，**不会自动生成密码**；更新时空密码表示清除原密码。`visibility="unlisted"` 表示不进创作广场，仍可通过链接访问；`public` 表示进创作广场，是否有密码是独立选项。密码仅随本次提交发送，发布列表和版本不返还密码明文。

`PublishPageDialog` 在提交过程中禁止关闭和重复提交。若返回 HTTP 200 但 `ok=false,status="partial"`，显示警告与已返回的地址，不自动重试或另建页面。

HTML 预览使用本系统保存的 `html`，iframe 设置 `sandbox="allow-scripts"`，不授予 `allow-same-origin`，因此内联脚本和图表可运行，但不能读取父业务页面的 Cookie、存储或 DOM。CSP 与正式 HTML 页面保持一致：允许 HTTPS 图片、样式、字体和脚本资源，禁止 `fetch`/XHR/WebSocket、表单提交和自定义 base；这不是可任意联网的执行环境。通过「打开」可访问实际发布页，通过「下载 HTML」拿到原内容。查看历史版本不会自动覆盖线上内容，更新需要再次提交发布表单。

## 模型与推理开关

`Composer.models` 中的 `ModelOption` 可设置：

```ts
{
  id: "12",
  name: "业务问答模型",
  contextWindow: 128000,
  supportsReasoning: true,
  reasoningEfforts: ["off", "low", "medium", "high"],
  defaultReasoningEffort: "low"
}
```

`selectedReasoning=""` 表示跟随模型。`"off"` 表示明确关闭思考，和 `"low"` 不同。只展示模型实际声明的选项：不支持关闭思考的模型不能强行增加 `off`；固定推理模型可切换到其他模型以处理简单问答。模型切换会重置原模型的覆盖值，跟随新模型参数。宿主还可通过 `reasoningOptions` 给旧数据结构提供选项；模型自身的 `reasoningEfforts` 优先。

App 从 `/api/agent/models` 读取服务端归一化的 `supports_reasoning`、`reasoning_efforts`、`default_reasoning_effort` 和上下文窗口。输入框下方的百分比根据所选模型立即重算；用量分子来自后端实际上下文统计，不伪造 token 数字。

工具 `ToolOption.selectable=false` 表示固定启用，不能通过「全选/清空」绕过。不可见工具无需发给客户端，后端根据管理员的四态规则和业务权限决定是否启用。

## 语音与供应商协议

前端始终发送浏览器录音到 **业务接口** `POST /api/agent/transcribe`：

```json
{ "audio_data_url": "data:audio/webm;base64,...", "language": "zh" }
```

`useVoiceInput(onRecognized, enabled)` 管理录音、60 秒上限、12 MB 上限、资源清理和错误状态，识别完成后调用宿主回调。App 会将识别文本直接发送为消息。录音类型根据浏览器支持选择 WebM、MP4 或 Ogg。

`GET /api/agent/status` 的 `asr.configured` 为真实可用性，`asr.reason` 为不可用原因；未配置或协议不可用于文件转写时按钮禁用，并展示原因。浏览器需要 HTTPS 或 localhost；麦克风是否可用仍由设备权限决定。

浏览器不会假设供应商都走 `/v1/audio/transcriptions`。后端模型 `extra_params._asr` 决定传输协议：

```json
{
  "_asr": {
    "protocol": "auto",
    "endpoint": "",
    "language": "zh"
  }
}
```

协议为 `auto | transcriptions | chat_audio | dashscope`。`endpoint` 可空，或填写供应商 URL/相对路径。文件识别与 WebSocket 实时 ASR 是两种能力，实时模型不能直接作为浏览器录音文件转写模型。私有 `_asr` 参数由后端消费，不能当作普通对话参数发给模型。

## 流式聊天和上下文

App 的 `useAgentConversation` 对接现有 `/api/agent/chat/stream` SSE，处理 `text.delta`、`thinking.delta`、工具、审批、用量、上下文、重试、降级和完成事件。更新合并到浏览器动画帧，消息内容直接进入 Markdown 组件。完成后读取真实会话消息，保留本次内存中的思考文本，遵守后台的思考原文落库开关；关闭页面后，未落库原文不会恢复。

断流时利用 `X-Run-Id` 和 `Last-Event-ID` 尝试恢复。按钮标为「停止接收（后台任务继续）」，不假装取消服务器任务；刷新会话可以读取后台已保存结果。单用户最多同时运行 4 个任务，同一会话执行中返回 409，避免并发修改历史。会话/消息删除有二次确认，流式占位消息禁止编辑/删除。业务表和其他配置页仍由 HTML 后台提供，模型管理已复用 React 组件。

Mermaid 在流式代码满足语法时尝试渲染，尚未闭合或不完整语法显示生成状态，不连续弹出解析错误；更新期间保留已有图形。普通文本按动画帧合并，HTML 页面不因过程计时重复解析正文。`src/lib/answerContent.ts` 提前提取流式 HTML，未闭合代码不会铺满聊天正文；过程行播放真实 HTML 片段，展开可查实际接收量，收尾文字仍正常渲染。

`ProcessLine` 在固定的一行内顺序播放真实动作、思考原文、已脱敏工具参数和结果、回答内容；长文本分段显示，积压时加快推进。悬停或键盘聚焦暂停播放，可手动暂停和前后查看；减少动态效果偏好下直接显示最新片段。展开后查看对应轮次完整内容，结束立即收起；历史会话默认折叠。`src/lib/processActivity.ts` 只使用真实事件，不生成虚构进度。

## 移动端与小程序

该目录是响应式 Web 组件，并非微信原生小程序包。390px 手机视口中列表、搜索、版本和发布表单使用同一数据契约，弹窗高度按 `100dvh` 限制、内部滚动、操作区保留安全边距。小程序可复用后端接口和 TypeScript 数据类型；原生组件需用小程序弹层、富文本、录音管理器和合法 WebView 域名实现。业务小程序已有数据 API 时可直接注册 HTTP Tool，无需先把数据接口改造成 MCP，详细步骤见根目录 `docs/INTEGRATION.md`。

## 验证建议

1. 启动真实业务后端，通过 `npm run dev` 登录不同账号；检查各自发布列表隔离。
2. 在自己会话的 HTML 产物中发布，确认本地记录、URL、版本和来源会话。
3. 更新自己页面，留空密码并选择可见范围，确认版本新增、URL不变。
4. 检查 390px 视口的弹窗、焦点、错误与空状态；Tab 不应离开已打开弹窗，Escape 关闭后焦点返回入口。
5. 服务未配置、403/404、`partial` 状态必须展示真实结果，不应出现假成功。

`npm run build` 执行 TypeScript 检查与 Vite 生产构建。集成测试需要隔离的假 PagePilot 服务以免把验收页面发布到用户的真实外部站点；生产组件本身没有模拟发布路径。
