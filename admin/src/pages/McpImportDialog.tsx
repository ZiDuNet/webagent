import { useState } from "react";
import { Alert, Input, Modal } from "antd";
import { apiErrorMessage, controlRequest } from "../api/pagepilot";

const example = { mcpServers: { "业务连接器": { type: "streamable-http", url: "https://business.example/mcp", headers: {}, tool_policies: { search: { permission: "record:read", risk: "read" } } } } };

export default function McpImportDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(JSON.stringify(example, null, 2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try {
      const input = JSON.parse(value);
      await controlRequest("/admin/mcp-servers/import", input);
      await onSaved(); onClose();
    } catch (failure) { setError(apiErrorMessage(failure)); }
    finally { setSaving(false); }
  };
  return <Modal open title="从 JSON 导入 MCP" width={780} onCancel={onClose} onOk={() => void save()} confirmLoading={saving} okText="导入连接器" cancelText="取消"><Alert type="info" showIcon title="支持标准 mcpServers 对象、HTTP / SSE / stdio。密钥按字面值加密保存，不会展开环境变量或执行命令；stdio 仅在部署者允许后运行。导入不会自动调用远端或开放权限。" style={{ marginBottom: 18 }} /><Input.TextArea aria-label="MCP JSON 配置" rows={16} spellCheck={false} value={value} onChange={(event) => setValue(event.target.value)} />{error && <Alert type="error" showIcon title={error} style={{ marginTop: 16 }} />}</Modal>;
}
