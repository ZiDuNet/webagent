# WebAgent-PI 验收说明

## 版本边界

此分支完全替换原服务与原生 HTML 应用，保留的业务 Demo 用于验证权限与接口，不是框架与设备系统的强绑定。文档以 Node / TypeScript、PI 官方 SDK、React Admin / Chat 三端为准。

不会因为本地测试通过就宣称所有外部模型或部署环境已经实测。测试供应商均为隔离的本机 Mock，不使用真实账号 Key、不发送用户会话到第三方。

## 自动化入口

```bash
npm run typecheck
npm test
npm run build
docker compose config --quiet
git diff --check
```

测试按 workspace 运行：

| 位置 | 覆盖 |
| --- | --- |
| `server/test/runtime.test.ts` | 真 PI SDK、流式正文 / 思考、canonical 恢复、工具、审批、BM25、压缩、预算、字面密钥 |
| `server/test/assistant-settings.test.ts` | 助手级语音 / TTS / 推理 / 执行模式覆盖、全局兜底、模型删除绑定校验 |
| `server/test/conversation-files.test.ts` | 会话正文文件持久化、旧数据库迁移、删除与保留期清理 |
| `server/test/api.test.ts` | 双身份隔离、CRUD 权限、会话归属、模型参数、决策筛选、记忆隔离、嵌入模式、MCP JSON |
| `server/test/connectors.test.ts` | STT / TTS 协议、官方 MCP HTTP、PagePilot 归属 / 更新、SSE 断线继续与真正取消 |
| `server/test/env.test.ts` | 已有环境配置只补缺失项，不轮换加密密钥、密码或覆盖自定义行 |
| `server/test/migration.test.ts` | 旧 SQLite `user_id NOT NULL` 表迁移、历史归属保留、无数字 ID 的稳定 `owner_key` 写入 |
| `sdk/test/client.test.ts` | SSE UTF-8 / CRLF 跨包解析、动态业务 Token、授权错误 |
| `chat/tests/conversationRun.test.mjs` | 单行实时过程状态、取消、折叠语义、思考、HTML 增量解析、片段有界保留 |

## 必须保持的回归条件

1. 管理 Cookie 不能当业务登录；业务管理员 Token 不能当框架管理员。
2. 没有模型时返回明确错误，不输出模型模拟内容。
3. user1 不可写，user2 不可删；审批后重新读取权限。
4. 关闭浏览器订阅后任务继续，显式 cancel 能终止 PI 上游请求。
5. 相同会话运行互斥，审批不可重放，重启不自动重放未知副作用。
6. PI 官方 Bash / PowerShell / 文件工具与 CodeMode 默认锁定且 PI runtime 不加载；只有部署者设 `WEBAGENT_LOCAL_TOOLS=admin` 且管理员逐项启用后才加载；Key 或 header 中 `!`、`$` 只作字面值。
7. BM25 / 决策不可同时开启，可以同时关闭；筛选不扩大授权。
8. 自动 / 手动压缩保留原始消息，轮次裁剪保留 PI 摘要。
9. 思考默认可实时看但不落库，中途关闭保存后最终消息也不写回。
10. PagePilot 共享 Token 下仍按本地 `owner_key` 隔离，更新不接受他人 code，密码不进入明文工具记录。
11. MCP 表单 / JSON 导入不直接执行工具，没映射权限默认不开放；HTTP / SSE 不启动本机服务进程，stdio 默认关闭且启用后会启动部署者指定进程。
12. 修改 / 删除消息使 PI 上下文和后续审批失效。
13. `ask_user` 暂停当前任务并生成用户归属的问答卡；无效答案、他人会话、过期问题和重复回答均被拒绝；模型校验失败不误取消已有待回答问题。
14. 决策筛选只能裁剪已授权候选，`ask_user` 和管理员固定启用的隐藏工具不会因低分丢失。

## UI 验收

- 管理与 Chat 两个独立入口的登录、导航、模型 / 工具弹窗可用。
- 输入框保留模型、推理、工具、审批模式和语音入口，不增加「简洁 / 标准 / 诊断」模式；非实时识别只回填，实时识别在输入框内增量显示。
- 过程单行展示真实事件，回答完成默认收起，用户可展开查看。
- Markdown / Mermaid / 图表增量输出，HTML 默认紧凑，不铺满源码。
- 模型补充信息时渲染独立问答卡，可选择、补充文本或取消，不使用危险操作审批卡代替。
- 移动端会话抽屉、模型切换、过程展开与弹窗适配。
- 辅助模型、模型列表、错误 / loading 状态不阻塞整个页面。

新版本截图只记录实际页面；旧截图明确标注历史版本，不复用为新架构的证明。

## 本次验证记录

2026-11-16 本机验证：

- 四个 workspace 类型检查、构建成功；自动回归 **89 项通过**：后端 57、SDK 4、Chat 28。
- 核心安装版本 API 返回三个官方 PI 包均为 `1.5.2`；CLI `core:upgrade` 无 `--apply` 的预检查通过，不执行在线安装。
- 实际 `8000` 服务健康检查、管理配置和业务只读 API 返回正常；管理 Cookie 与业务 Cookie 交叉访问均被拒绝。
- 管理端 Token 与 Chat 接入 Token 分离：管理 Token 可调用 `/api/control`，不能调用 `/api/agent`；来源白名单、停用、轮换与密码修改限制均有自动回归。
- 语音 TTS 增量切块、Markdown 表格 / HTML / 代码过滤、非阻塞结束和顺序播放已覆盖；真实供应商音色与延迟仍需在目标账号验收。
- 语音通话补齐浏览器麦克风生命周期、TTS 尾音打断、上游合成取消与旧运行落定后再继续的交互；Mock 覆盖协议行为，实际回声抑制仍取决于浏览器与耳机 / 扬声器环境。
- 隔离浏览器验收覆盖默认助手、新建会话、切换模型后的上下文预算变化、工具调用、思考展开、结束收起和本轮用量 / 耗时。
- Mermaid 节点完整可见，重绘不移除既有 SVG；375px 手机页面无横向溢出，宽图在组件内部滚动。手机更多操作与 HTML 预览弹窗可用。
- HTML PNG 由浏览器端清理文档后导出；后端没有 Chromium、Playwright 或截图接口。自动化覆盖清理策略和导出组件，隔离浏览器交互仍需在本次验收完成后记录。
- `git diff --check`、`docker compose config --quiet` 通过。当前用户没有 Docker daemon 权限，**没有执行镜像构建或容器启动验收**。
- 未向真实模型、语音、PagePilot 服务发送验收请求；不将 Mock 的耗时作为真实模型性能数据。

### 复现浏览器验收

```bash
npm run build
npm run test:ui
```

打开 `http://127.0.0.1:18900/admin/` 或 `/chat/`。独立管理测试账号为 `admin / webagent-ui-test`，业务测试账号为 `user1 / user1pass`；这些不是正式服务的管理密码。

该入口只监听回环地址，在系统临时目录建库，使用正式前后端与本机 Mock 模型，不是应用中的 Demo 回复开关。退出进程会关闭连接并删除临时库；异常强制退出留下的临时目录可由操作系统清理。可通过 `WEBAGENT_UI_TEST_PORT` 改端口。不要将此测试服务反向代理到公网。

## 仍需部署者实测

- 各供应商账号开通状态、计费、地域、模型 ID、推理参数与 STT / TTS 音色。
- 实际麦克风权限、音频文件质量、实时 ASR 的供应商限流与准确率。
- PagePilot 目标部署版本的真实创建、更新、密码、广场可见性及权限响应。
- 生产 HTML 预览的浏览器隔离行为、容器运行、HTTPS 反向代理与长连接超时。
- Node 24 目标运行环境；开发机器 Node 版本与容器基础镜像可能不同。
- 业务对象 / 租户 / 字段权限、业务 Token 撤销、幂等性和审计合规。

## 已知限制

- 单进程 SQLite，没有多副本共享任务调度与分布式锁。
- PI entries、展示消息与附件 Base64 在会话 JSON 文件中，不在 SQLite；大量历史需监控 `data/pi/conversations/` 并适配对象存储。
- 进程重启仅保留记录，不支持暂停的 Agent 执行栈自动续跑。
- 决策原始 IO 与未保存思考为短期内存，重启无法恢复。
- Chat 是响应式 Web，不是原生微信小程序。
- 普通 TTS 与实时通话 TTS 是两条独立链路；Chat 右上角已有朗读开关，实时通话仍需供应商支持 WebSocket 协议。
- 生图有模型配置与 OpenAI Images 真实测试，业务生图 Tool 需开发注册。
- Embedding / Rerank 已支持模型配置与真实协议测试；租户知识库、向量索引、PDF 解析沙箱、脚本型 Skill 未内置，接口文档明确保留。
- stdio MCP 不是安全沙箱，默认关闭；部署者显式启用后只运行信任且已安装的 MCP 服务。
- 结构化工具字段脱敏不是通用 DLP，不能保证清除用户正文中的敏感信息。
- 本分支不自动提交或推送代码；发布需单独确认。
