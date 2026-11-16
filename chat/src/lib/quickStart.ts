import type { QuickStart } from "../components/EmptyState/EmptyState";

export const DEFAULT_QUICK_START: QuickStart[] = [
  { title: "查询业务数据", description: "用只读工具查看设备、项目与运行状态" },
  { title: "分析当前情况", description: "梳理数据异常、风险点和处理优先级" },
  { title: "生成数据报表", description: "汇总指标并输出可发布的 HTML 页面" },
  { title: "制定执行计划", description: "拆解步骤、责任人和交付物" },
  { title: "优化已有内容", description: "按你的要求改写、精简或扩写" },
  { title: "记住我的偏好", description: "把长期有效的规则加入我的记忆" },
];

/** 每行一个快捷入口，支持 `标题|描述`；留空时使用内置示例。 */
export function parseQuickStart(raw: string[] | string | undefined): QuickStart[] {
  const lines = (Array.isArray(raw) ? raw : String(raw || "").split("\n")).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return DEFAULT_QUICK_START;
  return lines.slice(0, 6).map((line) => {
    const [title, ...rest] = line.split(/[|｜]/);
    return { title: title.trim(), description: rest.join(" ").trim() };
  }).filter((item) => item.title);
}
