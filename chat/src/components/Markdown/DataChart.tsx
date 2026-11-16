import { useId, useMemo } from "react";
import { CodeBox } from "../CodeBox/CodeBox";
import "./DataChart.css";

const COLORS: Record<string, string> = {
  blue: "#65a9ff", green: "#58c5a0", amber: "#eebc67", red: "#eb8290", purple: "#af9df5",
};

interface ChartPoint { label: string; value: number; tone: string }
interface ChartSpec { title: string; type: string; unit: string; data: ChartPoint[] }

function parseChart(source: string): ChartSpec | null {
  try {
    const raw = JSON.parse(source);
    if (!raw || !Array.isArray(raw.data) || !raw.data.length) return null;
    return {
      title: String(raw.title || "数据图表").slice(0, 120),
      unit: String(raw.unit || "").slice(0, 16),
      type: ["bar", "line", "area", "pie", "donut"].includes(raw.type) ? raw.type : "bar",
      data: raw.data.slice(0, 24).map((item: Record<string, unknown> | null) => ({
        label: String(item?.label ?? "").slice(0, 80),
        value: Number.isFinite(Number(item?.value)) ? Number(item?.value) : 0,
        tone: COLORS[String(item?.tone)] || COLORS.blue,
      })),
    };
  } catch {
    return null;
  }
}

export function DataChart({ source }: { source: string }) {
  const chart = useMemo(() => parseChart(source), [source]);
  const titleId = useId();
  if (!chart) return <CodeBox code={source} language="json" lineNumbers={false} />;
  const maximum = Math.max(1, ...chart.data.map((item) => Math.abs(item.value)));
  const total = chart.data.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const low = Math.min(0, ...chart.data.map((item) => item.value));
  const high = Math.max(1, ...chart.data.map((item) => item.value));
  const points = chart.data.map((item, index) => [
    26 + index / Math.max(1, chart.data.length - 1) * 466,
    142 - (item.value - low) / Math.max(1, high - low) * 126,
  ]);
  let offset = 0;
  const round = chart.type === "pie" || chart.type === "donut";

  return (
    <figure className="data-chart" aria-labelledby={titleId}>
      <figcaption><strong id={titleId}>{chart.title}</strong>{chart.unit && <span>单位：{chart.unit}</span>}</figcaption>
      {round ? <div className="data-chart__round">
        <svg viewBox="0 0 140 140" role="img" aria-label={chart.title}>
          <circle cx="70" cy="70" r="48" fill="none" stroke="var(--border-subtle, #293241)" strokeWidth="22" />
          <g transform="rotate(-90 70 70)" fill="none" strokeWidth="22">{chart.data.map((item, index) => {
            const fraction = total > 0 ? Math.max(0, item.value) / total : 0;
            const start = offset;
            offset += fraction * 302;
            return <circle key={index} cx="70" cy="70" r="48" stroke={item.tone} strokeDasharray={`${fraction * 302} 302`} strokeDashoffset={-start}><title>{item.label}：{item.value}{chart.unit}</title></circle>;
          })}</g>
          {chart.type === "donut" && <text x="70" y="74" textAnchor="middle" fill="currentColor">{total}</text>}
        </svg>
        <ul>{chart.data.map((item, index) => <li key={index}><i style={{ backgroundColor: item.tone }} /><span>{item.label}</span><strong>{item.value}{chart.unit}</strong></li>)}</ul>
      </div> : chart.type === "line" || chart.type === "area" ? <svg className="data-chart__trend" viewBox="0 0 520 180" role="img" aria-label={chart.title}>
        {[16, 79, 142].map((position) => <line key={position} x1="26" y1={position} x2="492" y2={position} stroke="var(--border-subtle, #293241)" />)}
        {chart.type === "area" && <polygon points={`26,142 ${points.map((point) => point.join(",")).join(" ")} 492,142`} fill={COLORS.blue} opacity=".15" />}
        <polyline points={points.map((point) => point.join(",")).join(" ")} fill="none" stroke={COLORS.blue} strokeWidth="2.5" />
        {points.map(([horizontal, vertical], index) => <g key={index}><circle cx={horizontal} cy={vertical} r="3" fill={chart.data[index].tone}><title>{chart.data[index].label}：{chart.data[index].value}{chart.unit}</title></circle>{(index % Math.ceil(points.length / 6) === 0 || index === points.length - 1) && <text x={horizontal} y="166" textAnchor="middle" fill="currentColor" fontSize="11">{chart.data[index].label.slice(0, 8)}</text>}</g>)}
      </svg> : <div className="data-chart__bars">{chart.data.map((item, index) => <div key={index}><span>{item.label}</span><i><b style={{ width: `${Math.max(0, Math.abs(item.value) / maximum * 100)}%`, backgroundColor: item.tone }} /></i><strong>{item.value}{chart.unit}</strong></div>)}</div>}
      <details className="data-chart__table"><summary>查看图表数据</summary><table><thead><tr><th>项目</th><th>数值{chart.unit ? `（${chart.unit}）` : ""}</th></tr></thead><tbody>{chart.data.map((item, index) => <tr key={index}><td>{item.label}</td><td>{item.value}</td></tr>)}</tbody></table></details>
    </figure>
  );
}
