export type Row = Record<string, any>;
export interface Identity {
  /** Demo/兼容用数字 ID；嵌入其他系统时可以为空，不伪造业务主键。 */
  id?: number;
  /** 业务系统内稳定身份。跨 Web/小程序/App 必须保持一致。 */
  subject: string;
  /** 多租户或业务域隔离前缀，可选。 */
  namespace?: string;
  /** 框架内部唯一归属键：namespace:subject 或 subject。 */
  owner_key: string;
  username: string;
  display_name?: string;
  role: string;
  permissions: string[];
  is_admin: boolean;
  /** 接入 Token 身份；存在时只允许访问 /api/agent/*。 */
  access_token_id?: number;
  access_token_name?: string;
  /** Token 绑定的助手；存在时不可切换。 */
  assistant_id?: number;
  allowed_assistant_ids?: number[];
  default_assistant_id?: number;
  /** Token 级每日 Token 配额；0 表示继承全局。 */
  daily_token_limit?: number;
  /** 接入模式：business 由业务系统适配器/登录提供，token 为匿名接入。 */
  auth_mode?: "business" | "token";
}
export function identityOwnerKey(subject: string, namespace?: string) {
  return namespace ? `${namespace}:${subject}` : subject;
}
export interface ExecutionContext {
  identity: Identity;
  credential: string;
  sessionId: string;
  signal: AbortSignal;
}
export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  permission: string;
  risk: "read" | "write" | "delete";
  category: string;
  source: "builtin" | "http" | "mcp" | "native" | "pi";
  parameters: Row;
  available?: () => boolean;
  execute: (args: Row, context: ExecutionContext) => Promise<unknown>;
}
export type Emit = (type: string, payload: Row) => void;
export class AppError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
export type IdentityInput = Omit<Identity, "owner_key" | "subject"> & { subject?: string; owner_key?: string };
export interface IdentityAdapter {
  resolve: (credential: string, signal?: AbortSignal) => Promise<IdentityInput | null>;
}
