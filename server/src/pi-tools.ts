import { createBashToolDefinition, createEditToolDefinition, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createPowerShellToolDefinition, createReadToolDefinition, createWriteToolDefinition, type ToolDefinition } from "@earendil-works/pi-coding-agent";

type AnyToolDefinition = ToolDefinition<any, any, any>;
type ToolDescription = Pick<AnyToolDefinition, "name" | "description" | "parameters">;

const describe = ({ name, description, parameters }: AnyToolDefinition): ToolDescription => ({ name, description, parameters });

export const piLocalTools: { definition: ReturnType<typeof describe>; title: string; capability: "shell" | "filesystem"; risk: "read" | "write" }[] = [
  { definition: describe(createBashToolDefinition("/")), title: "Bash 命令执行", capability: "shell", risk: "write" },
  { definition: describe(createPowerShellToolDefinition("/")), title: "PowerShell 命令执行", capability: "shell", risk: "write" },
  { definition: describe(createReadToolDefinition("/")), title: "读取本机文件", capability: "filesystem", risk: "read" },
  { definition: describe(createWriteToolDefinition("/")), title: "写入本机文件", capability: "filesystem", risk: "write" },
  { definition: describe(createEditToolDefinition("/")), title: "编辑本机文件", capability: "filesystem", risk: "write" },
  { definition: describe(createFindToolDefinition("/")), title: "查找本机文件", capability: "filesystem", risk: "read" },
  { definition: describe(createGrepToolDefinition("/")), title: "搜索本机文件内容", capability: "filesystem", risk: "read" },
  { definition: describe(createLsToolDefinition("/")), title: "列出本机目录", capability: "filesystem", risk: "read" },
];

export const piLocalToolNames = piLocalTools.map(({ definition }) => definition.name);
export const piLocalToolReason = "本部署不提供本机命令、文件访问或代码执行能力；PI 官方工具仅展示定义，管理开关和业务权限均不能解除此限制。";
export const runtimeToolNames = [...piLocalToolNames, "tool_search", "codemode"];

const factories: Record<string, (cwd: string) => AnyToolDefinition> = {
  bash: (cwd) => createBashToolDefinition(cwd),
  powershell: (cwd) => createPowerShellToolDefinition(cwd),
  read: (cwd) => createReadToolDefinition(cwd),
  write: (cwd) => createWriteToolDefinition(cwd),
  edit: (cwd) => createEditToolDefinition(cwd),
  find: (cwd) => createFindToolDefinition(cwd),
  grep: (cwd) => createGrepToolDefinition(cwd),
  ls: (cwd) => createLsToolDefinition(cwd),
};

export function createPiLocalDefinitions(cwd: string, enabled: Set<string>): AnyToolDefinition[] {
  return piLocalTools
    .filter(({ definition }) => enabled.has(definition.name))
    .flatMap(({ definition }) => factories[definition.name] ? [factories[definition.name](cwd)] : []);
}
