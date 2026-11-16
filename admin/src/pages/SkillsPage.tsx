import { useRef, useState } from "react";
import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag, Tooltip } from "antd";
import { FileArchive, FolderUp, Pencil, Trash2 } from "lucide-react";
import { apiErrorMessage, controlRequest } from "../api/pagepilot";
import { PageHeading, PageState, ResourceActions, useResource, type Row } from "./shared";

type SkillsData = { items: Row[]; global_enabled?: boolean; root?: string };

export default function SkillsPage() {
  const resource = useResource<SkillsData>("/admin/skills");
  const [draft, setDraft] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const zipRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const globalEnabled = resource.data?.global_enabled ?? true;

  const edit = (row: Row = {}) => {
    setDraft(row);
    setError("");
    form.resetFields();
    form.setFieldsValue({ enabled: true, content: "", ...row, files_json: JSON.stringify(row.files || {}, null, 2) });
  };

  const importZip = async (file?: File) => {
    if (!file) return;
    setImporting(true); setError(""); setNotice("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("无法读取 ZIP 文件"));
        reader.readAsDataURL(file);
      });
      const result = await controlRequest<{ updated: boolean; skill: Row }>("/admin/skills/import-zip", { filename: file.name, data_base64: dataUrl.split(",")[1] || "" });
      setNotice(`已${result.updated ? "更新" : "导入"}技能「${result.skill.name}」，包含 ${result.skill.metadata?.file_count || 0} 个参考文件。`);
      await resource.refresh();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setImporting(false);
    }
  };

  const importFolder = async (files?: FileList | null) => {
    if (!files?.length) return;
    setImporting(true); setError(""); setNotice("");
    try {
      const allowed = /\.(md|txt|json|ya?ml|csv)$/i;
      const entries = Array.from(files);
      const rejected = entries.find((file) => !allowed.test(file.name));
      if (rejected) throw new Error(`技能目录只允许文本文件，发现：${rejected.name}`);
      const payload = await Promise.all(entries.map(async (file) => ({
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        content: await file.text(),
      })));
      const result = await controlRequest<{ updated: boolean; skill: Row }>("/admin/skills/import-directory", { files: payload });
      setNotice(`已${result.updated ? "更新" : "导入"}技能「${result.skill.name}」，包含 ${result.skill.metadata?.file_count || 0} 个参考文件。`);
      await resource.refresh();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setImporting(false);
    }
  };

  const toggleGlobal = async (enabled: boolean) => {
    setError(""); setNotice("");
    try {
      await controlRequest("/admin/skills/global", { enabled }, "PUT");
      setNotice(enabled ? "已开启全局 Skill 加载。" : "已关闭全局 Skill 加载；目录仍保留，但不会进入模型上下文。");
      await resource.refresh();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    }
  };

  return (
    <>
      <PageHeading
        title="Skills"
        description={`Skill 以后端目录为唯一事实来源，不写入数据库。模型只看到名称与描述，需要时通过 PI 原生 read 工具读取 SKILL.md。${resource.data?.root ? `目录：${resource.data.root}` : ""}`}
        actions={
          <Space wrap>
            <Space size={6}><span className="control-muted">全局加载</span><Switch checked={globalEnabled} onChange={(enabled) => void toggleGlobal(enabled)} /></Space>
            <input ref={zipRef} hidden type="file" accept=".zip,application/zip" onChange={(event) => { void importZip(event.target.files?.[0]); event.target.value = ""; }} />
            <input ref={folderRef} hidden type="file" multiple {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(event) => { void importFolder(event.target.files); event.target.value = ""; }} />
            <Button icon={<FileArchive size={14} />} loading={importing} onClick={() => zipRef.current?.click()}>导入 ZIP</Button>
            <Button icon={<FolderUp size={14} />} loading={importing} onClick={() => folderRef.current?.click()}>导入目录</Button>
            <ResourceActions refresh={resource.refresh} add={() => edit()} label="新增技能" />
          </Space>
        }
      />
      {error && <Alert title={error} type="error" showIcon closable onClose={() => setError("")} style={{ marginBottom: 16 }} />}
      {notice && <Alert title={notice} type="success" showIcon closable onClose={() => setNotice("")} style={{ marginBottom: 16 }} />}
      <PageState {...resource}>
        <Table
          rowKey="slug"
          dataSource={resource.data?.items}
          scroll={{ x: 760 }}
          columns={[
            {
              title: "技能",
              dataIndex: "name",
              render: (value, row) => (
                <Space>
                  <strong>{value}</strong>
                  <Tag color={row.source === "builtin" ? "green" : row.source === "imported" ? "blue" : "default"}>
                    {row.source === "builtin" ? "内置" : row.source === "imported" ? "导入" : "自定义"}
                  </Tag>
                </Space>
              ),
            },
            { title: "标识", dataIndex: "slug" },
            { title: "说明", dataIndex: "description" },
            {
              title: "参考文件",
              render: (_, row) => (
                <Tooltip title={Object.keys(row.files || {}).join("、") || "无"}>
                  <Tag>{row.metadata?.file_count ?? Object.keys(row.files || {}).length} 个</Tag>
                </Tooltip>
              ),
            },
            {
              title: "启用",
              dataIndex: "enabled",
              render: (value, row) => (
                <Switch
                  checked={value}
                  onChange={async (enabled) => {
                    try {
                      await controlRequest(`/admin/skills/${row.slug}`, { enabled }, "PUT");
                      await resource.refresh();
                    } catch (failure) {
                      setError(apiErrorMessage(failure));
                    }
                  }}
                />
              ),
            },
            {
              title: "操作",
              render: (_, row) => (
                <Space>
                  <Button type="text" icon={<Pencil size={15} />} aria-label="编辑技能" onClick={() => edit(row)} />
                  <Popconfirm
                    title="删除技能？"
                    description="会删除后端 Skill 目录，不影响历史会话。"
                    onConfirm={async () => {
                      try {
                        await controlRequest(`/admin/skills/${row.slug}`, undefined, "DELETE");
                        await resource.refresh();
                      } catch (failure) {
                        setError(apiErrorMessage(failure));
                      }
                    }}
                  >
                    <Button type="text" danger icon={<Trash2 size={15} />} aria-label="删除技能" />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </PageState>
      <Modal
        open={draft !== null}
        title={draft?.slug ? "编辑技能" : "新增技能"}
        width={800}
        onCancel={() => setDraft(null)}
        okText="保存技能"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => form.submit()}
      >
        {error && <Alert title={error} type="error" showIcon />}
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setSaving(true); setError("");
            try {
              const files = JSON.parse(values.files_json || "{}");
              await controlRequest(`/admin/skills${draft?.slug ? `/${draft.slug}` : ""}`, { ...values, files }, draft?.slug ? "PUT" : "POST");
              setDraft(null);
              await resource.refresh();
            } catch (failure) {
              setError(apiErrorMessage(failure));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="control-grid">
            <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="slug" label="标识 slug" rules={[{ required: true }, { pattern: /^[a-z0-9][a-z0-9-]{0,79}$/, message: "使用小写字母、数字和短横线" }]}><Input disabled={Boolean(draft?.slug)} /></Form.Item>
          </div>
          <Form.Item name="description" label="技能目录说明"><Input.TextArea rows={2} maxLength={1000} /></Form.Item>
          <Form.Item name="content" label="Skill 正文 / SKILL.md"><Input.TextArea rows={10} spellCheck={false} /></Form.Item>
          <Form.Item name="files_json" label="参考文件（JSON 对象）" extra={'例如 {"references/status.md":"# 状态码说明"}。只允许文本，不能上传可执行脚本。'}><Input.TextArea rows={4} spellCheck={false} /></Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
