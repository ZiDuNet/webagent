# Docker Compose 部署与本机运行

## 1. 快速启动

环境要求：Docker Engine、Compose v2、Python 3（仅生成本地配置使用），以及能访问 Docker Hub、Debian、npm 和 PyPI 的构建网络。

```bash
python3 scripts/init_env.py
COMPOSE_BAKE=false docker compose up -d --build --wait --wait-timeout 180
docker compose ps
```

- 默认 React 聊天：`http://127.0.0.1:8080/`（跳转到同端口 `/react/`）
- 完整配置管理台：`http://127.0.0.1:8080/admin/`
- 整体健康检查：`http://127.0.0.1:8080/api/health`
- 管理员：`admin`，初始随机密码在本机 `.env` 的 `WEBAGENT_ADMIN_PASSWORD` 中。

`init_env.py` 用权限 `0600` 创建配置；文件已存在时不会重写、换密钥或覆盖密码。可使用 `--port 8088 --host 127.0.0.1 --no-demo-users` 初始化不同端口且不带普通演示用户的实例。`.env` 不提交 Git、不复制进镜像，管理员密码也不输出到日志。不要把 `docker compose config` 的完整展开结果贴进工单，其中可能包含秘密。

默认仍是明确标记的演示 Agent，不调用真实大模型。要使用真实模型，在管理台保存模型与 API Key，关闭演示模式。语音需要可用的文件转写模型；WebSocket 实时语音模型不是该入口支持的文件协议，具体限制见接入手册。

## 2. 服务与数据

| 服务 | 内部地址 | 负责内容 | 持久化 |
|---|---|---|---|
| business | `business:8000` | 登录、RBAC、设备表、同源 BFF、静态页面 | `business-data`：业务 SQLite |
| agent | `agent:8010` | 会话、模型、工具、审批、用量、发布记录 | `agent-data`：Agent SQLite |
| mcp | `mcp:8020` | 工具协议适配，透传用户身份访问业务 API | 无持久数据 |

仅业务端口映射到宿主机，默认绑定 `127.0.0.1`。Agent 和 MCP 不直接对外暴露；外部网页只通过业务 BFF 使用它们。三个服务使用同一多阶段镜像：Node 22 构建 React 与本地 Markdown 资源，Python 3.13 运行后端，包含 Chromium、FFmpeg 和中文字体。

服务以非 root UID/GID `10001` 运行，根文件系统只读，临时文件写入有容量限制的 `/tmp`，移除 Linux capabilities，禁止提权；业务与 Agent 数据卷可写。健康检查、依赖就绪、异常重启和日志轮转已配置。服务内部仅运行一个 worker，原因见第 5 节。

**容器数据与仓库内的 `data/` 完全独立**。启动 Compose 不会覆盖原生开发库，也不会自动迁入原有模型、密钥和会话。HTML 与 React 在同一容器实例共享登录态；容器默认 Cookie 名为 `wa_container_session`，与默认原生端口的 `wa_session` 区分。

## 3. 配置与日常命令

`.env.example` 仅解释变量，不含可部署的真实密钥。推荐用脚本生成 `.env`，不要直接以示例占位值部署。

| 配置 | 说明 |
|---|---|
| `WEBAGENT_HTTP_PORT` | 宿主业务端口，默认 8080 |
| `WEBAGENT_BIND_HOST` | 默认本机回环；确需局域网访问时再设指定网卡或 `0.0.0.0` |
| `WEBAGENT_INTERNAL_SECRET` | BFF、Agent、MCP 的内部调用密钥，必须一致 |
| `WEBAGENT_SECRET_KEY` | 独立、稳定的加密根密钥，丢失后已有供应商与连接器密文不可恢复 |
| `WEBAGENT_ADMIN_PASSWORD` | 只在首次创建业务数据库时设置 admin；修改环境变量不改变已有账号密码 |
| `WEBAGENT_SEED_DEMO_USERS` | 新库是否创建 user1/2/3，正式环境设 0；已有用户需管理员手动删除 |
| `WEBAGENT_COOKIE_SECURE` | HTTPS 设 1；纯 HTTP 本机开发为 0 |
| `WEBAGENT_SESSION_COOKIE` | 可选；同一主机部署多个实例时配置不同名字 |

```bash
docker compose logs --tail 100 business agent mcp
docker compose restart
docker compose stop
docker compose start --wait
COMPOSE_BAKE=false docker compose up -d --build --wait
docker compose down
```

`down` 保留命名卷；**`down -v` 会删除全部容器数据**，只能用于确定不要数据的隔离测试。更新镜像后使用 `up --build`，仅 `restart` 不会应用新镜像或新的环境变量。后台任务不因浏览器关闭而取消，但服务重启会中断尚未完成的内存任务，不承诺跨重启继续执行。

## 4. 备份与恢复

需要同时备份业务库、Agent 库和原始 `.env` 加密根密钥。默认 30 天会话保留策略不会清理 PagePilot 发布内容与版本，应另外规划容量与保留策略。

最简单的一致备份方式是停服务再复制整个数据目录，确保 WAL/SHM 文件一并保留：

```bash
backup_dir="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p -m 700 "$backup_dir"
docker compose stop
docker compose cp --archive business:/app/data "$backup_dir/business"
docker compose cp --archive agent:/app/data "$backup_dir/agent"
cp -p .env "$backup_dir/.env"
docker compose start --wait
```

确认复制成功再恢复服务。备份目录已被 Git 和 Docker 构建忽略；仍应另存到受控、加密的备份介质。不要只复制正在写入的 `.db`：SQLite WAL 中可能有尚未合并的数据。在线备份应改用 SQLite `Connection.backup()`，不要用文件复制代替事务一致快照。

恢复到已创建的目标服务（保持停止状态）：

```bash
docker compose stop
docker compose cp --archive "$backup_dir/business/." business:/app/data/
docker compose cp --archive "$backup_dir/agent/." agent:/app/data/
cp -p "$backup_dir/.env" .env
docker compose up -d --no-build --wait
```

只向空卷或已清空、确认可覆盖的恢复目标操作，避免遗留 WAL 与旧库混合；恢复前先备份目标。`--archive` 保留非 root 数据文件 UID/GID。跨部署迁移时一起恢复 `.env` 中原来的加密根密钥，否则连接器配置无法解密。原生 `data/` 迁入容器也遵循停机、整库复制和保留密钥原则，且需要确保属主 `10001:10001` 可写；不自动完成迁移。

## 5. 生产边界

- 此仓库是单机接入框架 Demo，不是已做分布式任务调度的生产平台。SQLite 适合当前规模，并不应为“性能”直接改成无授权的会话文件。
- 同一会话只能执行一个任务；单用户最多同时 4 个 SSE 任务，重放缓存在进程内。保持单 worker、单 Agent 副本，横向扩容前应将任务队列、运行锁、SSE 日志和审批执行状态外置。不要直接把 `--workers` 调大。
- 审批记录持久化，但正在执行的任务不能靠重启恢复；重启后再次提交写操作前核对业务结果，工具接入方应设计业务幂等键。
- 上游反向代理需关闭 SSE 缓冲与缓存，保留 `Last-Event-ID`，读取超时高于后台最大运行时长，例如 Nginx `proxy_buffering off; proxy_cache off; proxy_read_timeout 600s;`。
- 对外部署使用 HTTPS、Secure Cookie、私网内部服务与独立密钥，关闭演示模式、移除演示用户。共享的 PagePilot Token 只留在后端，发布归属按本地可信业务用户 ID 隔离，不向用户开放全量远端列表。
- 不支持上传任意脚本执行。动态 HTTP 工具仅由受信任管理员配置；业务 API 始终校验当前用户权限和对象归属。多租户、配额、SSO 与用户停用清理按接入手册扩展。
- 非 root 容器与只读根目录不能替代 HTML 渲染隔离。截图关闭 JavaScript、阻止外网请求；仍应对公网入口设置请求体限制与访问频率限制，敏感配置和聊天正文避免输出到日志。

## 6. 构建排错

**中文目录 / Buildx sharedkey 报错**：部分 Compose Bake/Buildx 组合会把非 ASCII 路径带入会话头，使用本文命令的 `COMPOSE_BAKE=false`。本机已验证此方式。基础镜像或包下载失败不是应用启动失败，应先检查仓库网络。

**需要代理**：Docker daemon 拉镜像的代理与 CLI/Buildx、构建容器的代理不是同一层。按本机网络分别配置；`localhost` 在普通构建容器中不是宿主机。不要把代理密码写入 Dockerfile 或提交 Git，也不要照搬某个开发者的本机代理地址。

**端口占用**：修改 `.env` 的业务端口后重新 `docker compose up -d --wait`。**健康失败**：先查看对应服务最近日志与 `/api/health`，确认内部地址使用服务名而不是容器内的 `127.0.0.1`。

**离线页面资源**：镜像已打包 Markdown、KaTeX 和 Mermaid，HTML 与 React 不依赖外部 CDN 才能显示正文、公式与图表。模型 API、第三方工具及 HTML 产物引用的外部资源仍各自需要网络。
