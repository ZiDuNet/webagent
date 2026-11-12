import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, "../web/vendor");
await mkdir(destination, { recursive: true });
for (const [source, target] of [
  ["markdown-it/dist/browser/markdown-it.umd.min.js", "markdown-it.min.js"],
  ["katex/dist/katex.min.js", "katex/katex.min.js"],
  ["katex/dist/katex.min.css", "katex/katex.min.css"],
  ["katex/dist/fonts", "katex/fonts"],
  ["mermaid/dist/mermaid.min.js", "mermaid/mermaid.min.js"],
  ["mermaid/dist/chunks", "mermaid/chunks"],
]) {
  const targetPath = resolve(destination, target);
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(resolve(root, "node_modules", source), targetPath, {
    recursive: true,
    filter: (path) => !path.endsWith(".map") && !path.endsWith(".d.ts"),
  });
}
console.log("HTML Markdown、公式与图表资源已复制到 web/vendor，可离线加载。");
