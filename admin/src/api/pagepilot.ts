export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
const TOKEN_KEY = "webagent.control.token";
const BASE_KEY = "webagent.control.base";
export const controlToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const controlBase = () => (localStorage.getItem(BASE_KEY) || String(import.meta.env.VITE_CONTROL_API_BASE || "/api/control")).replace(/\/+$/, "");
export function saveControlConnection(baseUrl: string, token: string) {
  const base = baseUrl.trim();
  const value = token.trim();
  if (base) localStorage.setItem(BASE_KEY, base);
  else localStorage.removeItem(BASE_KEY);
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}
export function clearControlToken() { localStorage.removeItem(TOKEN_KEY); }
export async function readApiResponse<Result>(response: Response): Promise<Result> {
  const text = await response.text(); let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { throw new ApiError(`接口返回非 JSON 数据（HTTP ${response.status}）`, response.status); }
  if (!response.ok) throw new ApiError(String(body.detail || body.message || "请求失败"), response.status);
  return body as Result;
}
export const apiErrorMessage = (error: unknown) => error instanceof Error ? error.message : "请求失败，请稍后重试";
export async function controlRequest<Result>(path: string, body?: unknown, method?: string): Promise<Result> {
  const base = controlBase();
  const token = controlToken();
  if (/^https?:\/\//i.test(base) && !token) throw new ApiError("跨域管理端必须使用管理 Token，或通过同源反向代理访问 /api/control", 401);
  const headers: Record<string, string> = { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return readApiResponse<Result>(await fetch(`${base}${path}`, { method: method || (body === undefined ? "GET" : "POST"), credentials: token ? "omit" : "same-origin", headers, body: body === undefined ? undefined : JSON.stringify(body) }));
}
