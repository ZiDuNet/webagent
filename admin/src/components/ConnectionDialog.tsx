import { useState } from "react";
import { Alert, Button, Form, Input, Modal } from "antd";
import { apiErrorMessage, controlToken, saveControlConnection } from "../api/pagepilot";

export function ConnectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const envBase = String(import.meta.env.VITE_CONTROL_API_BASE || "/api/control");
  const storedBase = localStorage.getItem("webagent.control.base") || (envBase.startsWith("http") ? envBase : "");

  const submit = async (values: { base_url?: string; token?: string }) => {
    setSaving(true);
    setError("");
    const base = (values.base_url?.trim() || envBase).replace(/\/+$/, "");
    const token = String(values.token || "").trim();
    try {
      const response = await fetch(`${base}/auth/me`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        credentials: "omit",
      });
      if (!response.ok) throw new Error(response.status === 401 ? "管理 Token 无效、已停用或已过期" : `连接失败（HTTP ${response.status}）`);
      saveControlConnection(values.base_url || "", token);
      onClose();
      window.location.reload();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="使用管理 Token 连接"
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnHidden
    >
      <Alert
        type="warning"
        showIcon
        title="管理 Token 等同于管理员凭据"
        description="只保存在当前浏览器 localStorage。请使用 HTTPS、设置过期时间和来源白名单，并在泄露后立即轮换。"
        style={{ marginBottom: 18 }}
      />
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 18 }} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ base_url: storedBase, token: controlToken() }}
        onFinish={submit}
      >
        <Form.Item
          name="base_url"
          label="管理 API 地址"
          extra="同源部署留空。跨域部署填写完整地址，例如 https://webagent.example.com/api/control。"
        >
          <Input placeholder="https://webagent.example.com/api/control" spellCheck={false} />
        </Form.Item>
        <Form.Item name="token" label="管理 Token" rules={[{ required: true, message: "请填写管理 Token" }]}>
          <Input.Password placeholder="wac_..." autoComplete="off" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} block>验证并连接</Button>
      </Form>
    </Modal>
  );
}
