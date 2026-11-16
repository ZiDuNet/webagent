export type PageVisibility = "unlisted" | "public";
export type PublicationStatus = "published" | "partial" | "failed" | "publishing";

export interface Publication {
  id: number;
  user_id: number;
  username: string;
  session_id: string | null;
  title: string;
  description: string;
  code: string;
  url: string;
  detail_url: string;
  visibility: PageVisibility;
  password_set: boolean;
  version: number;
  publish_count: number;
  size: number;
  status: PublicationStatus;
  created_at: string;
  updated_at: string;
  last_error?: string | null;
}

export interface PublicationVersion {
  id: number;
  version: number;
  title: string;
  description: string;
  url: string;
  visibility: PageVisibility;
  password_set: boolean;
  size: number;
  status: PublicationStatus;
  created_at: string;
}

export interface PublicationDetail extends Publication {
  html: string;
  versions: PublicationVersion[];
}

export interface PublicationList {
  items: Publication[];
  total: number;
  limit: number;
  offset: number;
}

export interface PublicationQuery {
  q?: string;
  sessionId?: string;
  limit?: number;
  offset?: number;
}

export interface PublishPageInput {
  html: string;
  title: string;
  description?: string;
  code?: string;
  access_password: string;
  visibility: PageVisibility;
  session_id?: string;
  publication_id?: number;
}

export interface PublishPageResult {
  ok: boolean;
  publication_id: number;
  code?: string;
  url?: string;
  detail_url?: string;
  title?: string;
  status?: PublicationStatus;
  warning?: string;
}

export class PagePilotApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PagePilotApiError";
  }
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof PagePilotApiError && error.status === 401) {
    return "登录已失效，请重新登录业务系统后再试。";
  }
  if (error instanceof Error) return error.message;
  return "请求失败，请稍后重试。";
}

export async function readApiResponse<Result>(response: Response): Promise<Result> {
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new PagePilotApiError(
        response.ok ? "服务器返回了无法解析的数据。" : `请求失败（HTTP ${response.status}）。`,
        response.status,
      );
    }
  }
  if (!response.ok) {
    const detail = payload.detail ?? payload.error ?? payload.message;
    throw new PagePilotApiError(
      typeof detail === "string" ? detail : `请求失败（HTTP ${response.status}）。`,
      response.status,
    );
  }
  return payload as Result;
}

export class PagePilotClient {
  readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: { baseUrl?: string; fetcher?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl ?? "/api/agent").replace(/\/$/, "");
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  private async request<Result>(path: string, init: RequestInit = {}): Promise<Result> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...init.headers },
    });
    return readApiResponse<Result>(response);
  }

  list(query: PublicationQuery = {}, signal?: AbortSignal): Promise<PublicationList> {
    const params = new URLSearchParams();
    if (query.q?.trim()) params.set("q", query.q.trim());
    if (query.sessionId) params.set("session_id", query.sessionId);
    params.set("limit", String(query.limit ?? 50));
    params.set("offset", String(query.offset ?? 0));
    return this.request(`/pagepilot/publications?${params.toString()}`, { signal });
  }

  async get(id: number, signal?: AbortSignal): Promise<PublicationDetail> {
    const result = await this.request<{ publication: PublicationDetail }>(
      `/pagepilot/publications/${encodeURIComponent(id)}`,
      { signal },
    );
    return result.publication;
  }

  async getVersion(
    id: number,
    versionId: number,
    signal?: AbortSignal,
  ): Promise<PublicationVersion & { html: string }> {
    const result = await this.request<{ version: PublicationVersion & { html: string } }>(
      `/pagepilot/publications/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
      { signal },
    );
    return result.version;
  }

  publish(input: PublishPageInput): Promise<PublishPageResult> {
    return this.request("/pagepilot/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }
}

export const pagePilotClient = new PagePilotClient();
