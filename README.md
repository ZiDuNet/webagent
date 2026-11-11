# WebAgent：把 Agent 接入现有业务后台的通用 Demo

这是一个可运行的三服务 Demo，用来验证一个核心命题：

> Agent 框架不和业务系统强耦合；Agent 不直连业务数据库，也不持有超级管理员权限。它通过 MCP 工具层，带着“当前登录用户”的身份调用业务 API。用户的权限，就是 Agent 的权限上限。

Demo 模拟了一张普通业务表（设备信息表），并把 Agent 对话、模型切换、工具选择、写操作审批、管理员治理和审计串成完整闭环。

---

## 1. 现在能体验什么

后台只有三个主菜单：

1. **AI 对话**
2. **设备信息表**
3. **AI 配置**

### 用户侧

- 管理员预定义模型，用户可在对话输入框切换模型。
- 工具按“账号权限 ∩ 管理员全局开关 ∩ 本轮用户勾选”实时过滤。
- 用户可在「工具」弹层中决定本轮让 Agent 使用哪些工具。
- 查询类工具直接执行；新增、修改、删除返回审批卡，用户批准后才执行。
- 对话历史保存在浏览器本地，按用户隔离。

### 管理员侧

- **AI 模型**：新增、编辑、启停、设默认模型。
- **可用工具**：查看 MCP 工具清单、权限、风险等级，并做全局启停。
- **技能管理**：维护会注入 Agent system prompt 的业务规范。
- **用户管理**：查看用户权限，删除普通用户。
- **审计日志**：合并展示业务日志和 Agent 日志。
- **连接配置**：维护 LLM Base URL、API Key、Temperature、最大工具轮次、演示模式和补充 Prompt。

### 演示账号

| 用户名 | 密码 | 权限 |
|---|---|---|
| `admin` | `admin123` | 全部设备权限、用户管理、全部工具 |
| `user1` | `user1pass` | 只能查询设备 |
| `user2` | `user2pass` | 查询 + 修改设备（审批后执行） |
| `user3` | `user3pass` | 查询 + 修改 + 删除设备（审批后执行） |

> 不配置 API Key 也能完整体验。系统会进入内置的“演示模式”，用确定性意图识别走完 MCP 工具调用、权限校验和审批流程。

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

要求 Python 3.11+（本 Demo 在 Python 3.14 上验证）。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run_demo.py
```

打开 <http://127.0.0.1:8000>。也可以：

```bash
python run_demo.py --open
```

启动脚本会同时拉起：

- 业务系统：`127.0.0.1:8000`
- Agent 服务：`127.0.0.1:8010`
- MCP 服务：`127.0.0.1:8020`

日志在 `logs/`，SQLite 数据在 `data/`。

### 使用真实 LLM

用 `admin` 登录 → `AI 配置 → 连接配置`：

1. 填写 OpenAI-compatible Base URL。
2. 填写 API Key（只会保存在 Agent 服务端，前端只显示掩码）。
3. 关闭「演示模式」。
4. 保存后点「测试」。
5. 在「AI 模型」中确保目标模型已启用。

任何 OpenAI-compatible 网关都可以：OpenAI、DeepSeek、通义、OneAPI、NewAPI、vLLM 等。

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
| `WEBAGENT_SESSION_HOURS` | `24` | 登录会话有效期 |

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
5. Agent 做三层过滤：
   用户权限 ∩ 管理员全局启用 ∩ 用户本轮勾选
6. LLM 选择 update_device，但 risk=write，Agent 不执行，先返回审批卡。
7. 用户批准。
8. Agent 调 MCP update_device，仍然携带 user2 的 Token。
9. MCP 请求业务系统 PATCH /api/devices/2，仍然携带 user2 的 Token。
10. 业务系统执行最终 RBAC 校验；成功后才写库并记录 agent-mcp 审计。
```

即使有人在浏览器里伪造 `user_id=1`、修改前端开关或直接调用 Agent 接口，也拿不到额外权限：

- Agent 不信任浏览器传来的用户 ID。
- Agent 接口要求内部服务密钥。
- 工具执行始终使用当前会话 Token。
- 业务 API 是最后一道，也是最终的授权边界。

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
| `write` | 新增、修改、启停 | 用户审批后执行 |
| `delete` | 删除、清空、撤销 | 强提示 + 用户审批 |

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

## 6. 接入一个新系统的推荐步骤

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

### 第 4 步：接入 Agent Gateway

Agent 侧只需要：

- `GET /api/me` 获取身份与权限。
- `list_tools` 获取工具清单。
- 按权限/全局开关/本轮勾选过滤。
- 调用模型。
- 写工具需要审批。
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
- 审批过期、跨用户审批、重复审批。
- 业务 API 直接越权调用（必须仍被拒绝）。

可以运行本仓库的冒烟测试：

```bash
python scripts/smoke_test.py
```

---

## 7. 为什么这样设计

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

### 为什么工具选择要做三层交集

```text
最终可用工具 = 账号权限 ∩ 管理员全局开关 ∩ 用户本轮勾选
```

- 账号权限决定“能不能”。
- 管理员开关决定“系统允不允许”。
- 用户勾选决定“这一轮想不想用”。

任何一层都不能替代另外两层。

### 参考项目带来的启发

- 宝塔 `bt-ai-code`：服务端 Agent loop、工具风险分级、按需技能、审计与确认闸。
- Agent2API：模型网关分层、工具 manifest、前端确认卡和工具选择体验。

本仓库为独立实现，没有复制参考项目源码。若后续要复用 Agent2API 代码，请注意其 AGPL-3.0 许可；宝塔代码也需确认授权与版权边界。

---

## 8. 目录结构

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
    db.py                   模型、工具开关、技能、设置、Agent 审计
    mcp_client.py           携带用户 Token 的 MCP Client
    llm.py                  OpenAI-compatible 调用与 system prompt
    runtime.py              工具过滤、Demo/真实 Agent loop、审批
    app.py                  Agent Gateway API
web/
  index.html
  styles.css
  app.js
run_demo.py
requirements.txt
scripts/smoke_test.py
docs/ARCHITECTURE.md
```

---

## 9. 当前 Demo 的边界

这是用来讨论架构和交互的 Demo，不是直接可上生产的成品：

- 审批状态保存在 Agent 进程内存，重启会丢失。
- SQLite 适合单机演示，不适合高并发多实例。
- 没有接入企业 SSO、OAuth2、多租户组织树。
- 对话是普通 JSON 请求，尚未做 SSE 流式与断线重放。
- MCP 工具清单是静态注册，尚未做动态 Connector Registry。
- 没有做模型级成本配额、租户级限流、PII 脱敏和长期审计归档。
- 演示模式的意图识别只覆盖设备场景，真实效果应使用 LLM。

下一步产品化建议：

1. 把 MCP 适配器抽成 Connector SDK / 模板。
2. 审批状态落到 Redis 或数据库，支持多实例。
3. Agent 输出改 SSE，支持工具进度和断线重放。
4. 加入租户、组织、数据域和记忆隔离。
5. 接入 OIDC / SSO，统一短期 Token 交换。
6. 加限流、配额、模型路由、提示词版本和审计归档。
7. 做 Connector 市场：每个业务系统一个可安装适配器。

