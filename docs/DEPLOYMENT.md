# 部署与运维

## 1. 环境

- 推荐 Node.js 24 LTS；最低 22.19.0，使用内置 `node:sqlite`、全局 fetch 与 Web Streams。
- npm workspaces：从仓库根目录安装、测试、构建。
- 图片导出与录音重采样运行在用户浏览器中；后端不需要 `ffmpeg`、Chromium 或 Playwright。
- 不需要 Python、pip、venv 或独立 Python MCP 服务。

```bash
npm ci --registry=https://registry.npmjs.org
npm run init:env
npm run typecheck
npm test
npm run build
npm start
```

无 `.env` 的直接运行保留 `admin123` 作为本机开发后备值，不可用于公开部署；正式环境必须使用随机独立密码和持久化加密密钥。初始化脚本拒绝覆盖 `.env`；旧环境可运行 `npm run init:env -- --extend`，只追加缺失项，保留原加密密钥及业务密码，并生成独立管理密码。

## 2. 环境变量

| 变量 | 默认 / 说明 |
| --- | --- |
| `WEBAGENT_BIND_HOST` | `127.0.0.1`，容器内部设 `0.0.0.0` |
| `WEBAGENT_PORT` | 后端 `8000` |
| `WEBAGENT_CONTROL_PASSWORD` | 首次创建独立管理账号 `admin` 的密码；已有账号时不会自动覆盖 |
| `WEBAGENT_RESET_CONTROL_PASSWORD` | 设为 `1` 时，本次启动把 `admin` 密码重置为 `WEBAGENT_CONTROL_PASSWORD` 并撤销管理会话；恢复后请移除 |
| `WEBAGENT_SECRET_KEY` | 凭据加密根密钥；丢失则无法解密已保存 Key，必须备份 |
| `WEBAGENT_DATA_DIR` | 数据根目录，默认 `./data`；相对路径基于项目根目录，不基于 workspace 当前目录。旧 `WEBAGENT_PI_DATA_DIR` 仅作为兼容读取 |
| `WEBAGENT_LEGACY_DIR` | `npm run migrate` 的旧库源目录，默认 `legacy/` |
| `WEBAGENT_MODELSDEV_WARMUP` | 默认开启；设为 `0` 时启动不后台拉取 models.dev |
| `WEBAGENT_COOKIE_SECURE` | HTTPS 部署设置 `1`；本机 HTTP 为 `0` |
| `WEBAGENT_SESSION_HOURS` | 登录过期时长，默认 24 小时 |
| `WEBAGENT_ALLOW_STDIO` | 默认 `0`，是否允许服务端启动 stdio MCP |
| `WEBAGENT_LOCAL_TOOLS` | 默认 `off`；设为 `admin` 仅解除部署级锁定，管理员仍需在工具页逐项启用 PI 本机执行工具 |
| `WEBAGENT_UI_ORIGINS` | 精确逗号分隔 Origin 白名单；优先同源代理，不用宽泛 `*` |
| `WEBAGENT_CHAT_PORT` / `WEBAGENT_ADMIN_PORT` | Compose 前端默认 8080 / 8081 |
| `WEBAGENT_CHAT_URL` / `WEBAGENT_ADMIN_URL` | Compose 构建时写入跨端跳转的公开地址 |
| `WEBAGENT_BUSINESS_URL` | Compose Chat 的可选返回业务系统地址 |

密码变量只在对应账号表为空时使用。修改管理密码请在管理端「PI 核心」操作，会撤销所有管理登录。只改 `.env` 不重置数据库内已有密码。

供应商 Key 等运行配置在后台维护；不把真实 Key 写入仓库、截图、镜像 build args 或 README。

## 3. 独立部署三个服务

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

- `backend`：Node / Fastify / PI，内部 `8000`，不映射宿主端口。
- `admin`：Nginx，只代理 `/api/control/`，其余业务 API 拒绝。
- `chat`：Nginx，代理业务和 Agent API，拒绝 `/api/control/`。
- `pi-data`：命名卷保存数据，容器重建不丢会话与模型配置。
- 容器非 root、只读根目录，写入限于数据卷和 `/tmp`，日志轮转；无需配置浏览器二进制或本机媒体转码工具。
- 两个 Nginx 都把访问日志和错误日志输出到容器 stdout / stderr，访问日志包含请求耗时 `rt`、上游耗时 `urt`、上游地址 `ua` 和请求 ID `rid`，并透传 `X-Request-ID`。Compose 对 backend / admin / chat 统一按 10 MB × 3 个文件轮转，避免长期运行撑爆磁盘。

PI 官方 Bash / PowerShell、文件读写与 CodeMode 在管理端列出，但默认 `WEBAGENT_LOCAL_TOOLS=off` 时锁定且不会进入模型工具列表。部署者显式设为 `admin` 后，管理员仍需在工具页逐项启用；API 请求和旧数据库配置不能自行越过部署级锁定。本机执行工具没有沙箱，会继承后端进程的文件和网络权限，只适合受信任的单租户部署。后端默认不提供任意命令执行、文件操作或截图接口。stdio MCP 同样会由后端启动管理员指定的本机服务进程，默认关闭；只对信任的 MCP 服务设置 `WEBAGENT_ALLOW_STDIO=1`，并自行承担进程隔离和部署风险。若不需要这些能力，保持默认关闭并使用受控的 Streamable HTTP / SSE MCP。

Compose 默认 localhost 端口，远程部署时设置实际域名，例如：

```dotenv
WEBAGENT_CHAT_URL=https://chat.example.com/chat/
WEBAGENT_ADMIN_URL=https://control.example.com/admin/
WEBAGENT_COOKIE_SECURE=1
```

Vite 的 `VITE_*` 是公开的构建时变量，不能存任何密钥。变更公开 URL 后需要重新 build 前端。非 Compose 可分别在 `admin/.env.local`、`chat/.env.local` 设置 `VITE_CHAT_URL`、`VITE_ADMIN_URL`、`VITE_BUSINESS_URL`；跨域管理端可设置公开地址 `VITE_CONTROL_API_BASE`，但管理 Token 必须在登录页输入，不能放进构建变量。

两个 Nginx 配置都保留 Host 以通过同源写入检查。Chat 代理关闭缓冲、压缩和缓存并延长 SSE 超时；负载均衡 / CDN 也应关闭流缓冲。不要把 `proxy_buffering off` 误当作后端任务持久化。

## 4. 三种业务集成形态

框架把「后端 API」「管理端静态资源」「Chat 静态资源」拆开。`WEBAGENT_SERVE_ADMIN` 与 `WEBAGENT_SERVE_CHAT` 只控制 Node 是否托管静态文件，不改变 API 和权限。三种形态可共用同一个后端镜像。

### A. Chat 嵌入业务系统；管理端 + 后端同一容器

适合已有业务门户、希望用户直接在业务页面打开对话的场景。

```dotenv
WEBAGENT_SERVE_CHAT=0
WEBAGENT_SERVE_ADMIN=1
```

- 业务前端构建 `chat/`，放到自己的静态目录（例如 `/agent/`）。
- 业务网关把 `/api/agent/`、`/api/me` 代理到后端；`/api/control/` 仅代理到管理端入口。
- 后端继续提供 `/admin/`，也可以只暴露 API，由单独的管理域名反向代理。
- 业务系统只负责身份和静态资源，不需要把 Agent 代码复制进业务工程。

### B. Chat + 管理端都嵌入业务系统；后端独立容器

适合已有统一门户和统一发布流水线，希望两个前端都由业务系统托管。

```dotenv
WEBAGENT_SERVE_CHAT=0
WEBAGENT_SERVE_ADMIN=0
```

- 业务系统分别托管 `chat/dist` 与 `admin/dist`，或只托管 Chat，管理端放在内网。
- 业务网关必须转发 `/api/agent/` 与 `/api/control/`；两者都保持同源。
- 管理登录 Cookie 的 Path 是 `/api/control`，不会自动变成业务 Cookie；业务身份仍由 `IdentityAdapter` 或同源代理解析。
- 后端容器只暴露内部端口，不把管理 API 直接暴露到公网。

如果管理端与后端不同源，推荐在「接入与安全 → 管理端 Token」签发专用 Token，并在管理端登录页填写 API 地址。管理端也可以在构建时设置公开变量 `VITE_CONTROL_API_BASE`（例如 `https://agent.example.com/api/control`），但该变量不是密钥；实际 Token 只保存在操作者浏览器。跨域时把管理端 Origin 加入 Token 白名单，并确保代理转发 `Authorization`。管理 Token 仅用于 `/api/control`，不得写入 Chat 前端或业务页面。

### C. 全部集成进业务系统（Node 宿主或反向代理）

Node 宿主可以直接创建后端服务，不必单独跑 Agent 容器：

```ts
import { createWebAgent } from "@webagent/server";

const service = await createWebAgent({
  identityAdapter,
  tools: businessTools,
  staticUi: false,
});

await service.app.listen({ host: "127.0.0.1", port: 8100 });
```

业务系统负责登录页、静态资源和 `/api/agent`、`/api/control` 的同源代理。非 Node 业务系统使用同样的反向代理方式，把后端作为独立容器运行。`staticUi:false` 不会关闭 API，也不会自动加载示例业务；它只关闭 Node 的静态文件托管。

三种形态共同要求：

- 前端与 API 同源，或通过精确的 `WEBAGENT_UI_ORIGINS` 白名单；不要用宽泛 `*`。
- SSE 代理关闭缓冲、压缩和缓存，并延长读超时；否则会出现「一次性吐出全文」的假流式。
- 管理端与业务端身份域独立。业务 Token 不能调用 `/api/control`，管理 Cookie 也不能读取业务数据。
- 跨端共享会话依赖稳定的业务 `subject + namespace`，见 [业务接入手册](INTEGRATION.md#跨端会话与稳定身份)。

`deploy/business-proxy.conf` 提供了业务网关的最小反向代理片段，可按实际域名、TLS 和路径调整。

## 5. 可选导入既有 SQLite

导入工具完全使用 Node SQLite backup，不需要旧应用或解释器：

```bash
npm run migrate
npm start
```

行为：

1. 从 `WEBAGENT_LEGACY_DIR`（默认 `legacy/`）找旧 `agent.db`。
2. 先做一致性备份到 `data/runtime/backups/before-import-*`。
3. 导入 `data/runtime/agent.db`；目标已存在则拒绝覆盖。
4. 新后端初始化自己的表与 PI 状态；旧数据库原样保留。
5. 首次启动会把旧配置表导出为 `data/config/*.json`，再写入 `VACUUM INTO` 备份并删除表。
6. 供应商 / Token 解密需要原来的 `WEBAGENT_SECRET_KEY`；恢复后重封装为 AES-GCM。

旧业务账号表不再读取，业务身份统一由 `IdentityAdapter` 或接入 Token 提供。启动时会自动把旧会话表的历史 `user_id` 迁移为 `owner_key`，并移除历史 `NOT NULL` 约束，以支持没有数字主键的嵌入身份；迁移保留原值，不伪造业务用户 ID。旧连接器名称 / 权限和模型专用协议必须重新检查，不把旧 MCP 配置自动开放。旧审批不自动执行。

迁移前确认源数据库实际使用的加密根密钥，而不是仅检查当前 `.env`。如果旧环境曾更换过密钥，须从原部署备份恢复正确密钥后处理；导入器不会猜测密钥，也不会把无法解密的值当作可用凭据。不要删除原库与备份来绕过错误。

即使备份 API 支持在线源库，也建议先停止业务写入，确保两个库之间一致。导入目标一经启动，不要反复覆盖。

## 6. 日常备份与恢复

停后端后备份整个数据目录与 `.env`，或使用 SQLite backup API；不要在 WAL 活跃时只复制单独 `.db` 而漏掉日志。备份文件含会话、文档和加密凭据，按敏感数据管理。

恢复时同时恢复加密根密钥与数据目录，再启动相同版本或已验证兼容的新版本。进程重启后，未完成任务显示 `interrupted`；待执行审批、发布结果不明的操作须核对，不自动重放。

默认清理：会话 30 天、事件 1 天；发布内容版本不随会话保留策略删除，需业务自行确定档案保留和清理策略。聊天正文与 PI entries 保存在 `data/sessions/*.json`，图片附件保存在 `data/uploads/<sessionId>/`（JSON 只存相对路径），均不在 SQLite；备份必须覆盖整个 `data/`，生产大量多模态历史宜适配对象存储。

## 7. PI 升级

```bash
npm run core:upgrade -- 1.5.2
npm run core:upgrade -- 1.5.2 --apply
```

仅接受 npm 官方源精确稳定版本；先停服，再备份、同步三个包、安装、类型检查、测试、构建。未通过则恢复 manifest / lockfile 并尝试 `npm ci`。不会自动提交、推送或重启。

管理 API 只返回升级计划。容器环境应在受控源码环境升级后重新构建和发布镜像。不要向 HTTP 接口开放任意 shell、包名或 npm URL。

## 8. 生产扩展边界

此版本为单进程 SQLite 方案。多副本会导致本地 Run、短期事件和任务锁不共享，不受支持。横向扩展至少需适配共享关系数据库、任务队列、分布式会话锁、取消信号、事件总线、对象存储与独立连接器进程隔离。

健康检查只说明服务可接收请求，不表示所有外部模型 / MCP / PagePilot 当前可用。请监控模型请求耗时、错误、运行取消、磁盘与队列容量。
