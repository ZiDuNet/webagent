# 截图版本说明

## WebAgent-PI

以下 PNG 为当前正式 React 应用的浏览器截图。后端使用真实 PI SDK，数据与上游仅限临时 SQLite 和本机 Mock，不含真实账号密钥与会话。可通过 `npm run test:ui` 复现，并非独立原型页面。

| 文件 | 内容 |
| --- | --- |
| `pi-admin-models.png` | 独立管理端、供应商和模型用途分类 |
| `pi-admin-core.png` | PI 三个核心包安装版本与受控升级入口 |
| `pi-chat-desktop.png` | 桌面对话、完成后折叠的过程、Markdown 表格及 Mermaid |
| `pi-chat-mobile-process.png` | 375px 手机端展开执行过程和本轮思考原文 |
| `pi-chat-mobile-html.png` | 手机端隔离 HTML 预览与下载、截图、发布入口 |

## 历史参考

此目录原有 JPG 来自重构前版本，仅保留为历史 UI 设计参考；其中原生 HTML 管理页、旧业务页面和端口描述不代表 `WebAgent-PI` 的部署与功能验收。

新架构的真实入口是独立 React `/admin/` 与 `/chat/`，实现和验收以当前源码、README、测试及新版本截图为准。新截图应使用不含供应商 Key、Token 和真实用户会话的隔离数据。

历史文件：`admin-models.jpg`、`admin-decision.jpg`、`admin-runtime.jpg`、`admin-tools.jpg`、`admin-voice.jpg`、`chat-desktop.jpg`、`chat-mermaid.jpg`、`chat-mobile.jpg`、`chat-process.jpg`。
