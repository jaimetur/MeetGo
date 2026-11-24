import { getLang } from "@lang";

function computeApiBase() {
  const envBase = (import.meta as any).env.VITE_API_BASE;
  if (envBase) return String(envBase).replace(/\/+$/, "");
  const { protocol, host, hostname, port } = window.location;
  const isDev = port === "5173" || port === "5172";
  if (isDev) return `${protocol}//${hostname}:18000`;
  // inside the MeetGo app (www.meetgo.app/app/admin): the same API as the app
  if (hostname === "meetgo.app" || (hostname.endsWith(".meetgo.app") && hostname !== "admin.meetgo.app")) return "https://api.meetgo.app";
  return `${protocol}//${host}/api`;
}

export const API_BASE = computeApiBase();

// ---- Frontend logger hook (App.tsx can subscribe) ----
type LogLevel = "log" | "warn" | "error";
export type FrontLogEntry = {
  ts: string;
  level: LogLevel;
  msg: string;
  data?: any;
};

let _logListener: ((e: FrontLogEntry) => void) | null = null;

export function setFrontendLogListener(fn: ((e: FrontLogEntry) => void) | null) {
  _logListener = fn;
}

function emitFrontLog(level: LogLevel, msg: string, data?: any) {
  try {
    _logListener?.({
      ts: new Date().toISOString(),
      level,
      msg,
      data,
    });
  } catch {
    // never break the app due to logging
  }
}

export function frontLog(msg: string, data?: any) {
  console.log(msg, data);
  emitFrontLog("log", msg, data);
}

export function frontWarn(msg: string, data?: any) {
  console.warn(msg, data);
  emitFrontLog("warn", msg, data);
}

export function frontError(msg: string, data?: any) {
  console.error(msg, data);
  emitFrontLog("error", msg, data);
}

export type Token = { access_token: string; password_temp?: boolean };

export function getToken(): string {
  // inside the app, the administrator's own session (an administrator of MeetGo signs in to the app as usual)
  return localStorage.getItem("admin_token") || localStorage.getItem("token") || "";
}
export function setToken(t: string) {
  localStorage.setItem("admin_token", t);
}
export function clearToken() {
  localStorage.removeItem("admin_token");
}

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function req(path: string, opts: RequestInit = {}) {
  const headers: any = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = headers["Content-Type"] || "application/json";
  headers["X-Lang"] = getLang();
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const url = API_BASE + path;
  const method = (opts.method || "GET").toUpperCase();
  let res: Response;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch (e: any) {
    frontError(`[API] ${method} ${url} NETWORK_ERROR`, { error: e?.message || String(e) });
    throw new Error(`NETWORK_ERROR ${e?.message || String(e)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    const parsed = safeJsonParse(text);
    frontError(`[API] ${method} ${path} -> ${res.status}`, {
      url,
      status: res.status,
      response: parsed ?? text,
    });
    // FastAPI answers {"detail": "message"} (or a list of field errors): show the message itself.
    const detail = parsed?.detail;
    const message = typeof detail === "string" ? detail
      : Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join("; ") : "";
    const err: Error & { status?: number } = new Error(message || text || res.statusText);
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  API_BASE,
  async login(username: string, password: string) {
    return await req("/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
  },
  async settings() {
    return await req("/admin/settings");
  },
  async saveSettings(payload: any) {
    return await req("/admin/settings", { method: "PUT", body: JSON.stringify(payload) });
  },
  async smtpTest(to_email: string) {
    return await req("/admin/smtp/test", { method: "POST", body: JSON.stringify({ to_email }) });
  },
  async users(q?: string) {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return await req(`/admin/users${qs}`);
  },
  async createUser(payload: any) {
    return await req("/admin/users", { method: "POST", body: JSON.stringify(payload) });
  },
  async updateUser(id: number, payload: any) {
    return await req(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  async resendVerification(id: number) {
    return await req(`/admin/users/${id}/resend-verification`, { method: "POST" });
  },
  async deleteUser(id: number) {
    return await req(`/admin/users/${id}`, { method: "DELETE" });
  },
  async interests() {
    return await req("/interests");
  },
  async createInterest(payload: any) {
    return await req("/admin/interests", { method: "POST", body: JSON.stringify(payload) });
  },
  async updateInterest(id: number, payload: any) {
    return await req(`/admin/interests/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  async deleteInterest(id: number) {
    return await req(`/admin/interests/${id}`, { method: "DELETE" });
  },
  async setAccess(id: number, free_until: "lifetime" | "none" | string) {
    return await req(`/admin/users/${id}/access`, { method: "PUT", body: JSON.stringify({ free_until }) });
  },
  async reports(status: ReportStatus = "open"): Promise<Report[]> {
    return await req(`/admin/reports?status=${encodeURIComponent(status)}`);
  },
  async resolveReport(id: number, payload: { status: "dismissed" | "actioned"; delete_message: boolean }) {
    return await req(`/admin/reports/${id}/resolve`, { method: "POST", body: JSON.stringify(payload) });
  },
  async billing(): Promise<BillingInfo> {
    return await req("/admin/billing");
  },
  async saveBilling(payload: BillingUpdate): Promise<BillingInfo> {
    return await req("/admin/billing", { method: "PUT", body: JSON.stringify(payload) });
  },
  async promoCodes(): Promise<PromoCode[]> {
    return await req("/admin/promo-codes");
  },
  async savePromoCode(payload: PromoCodeIn): Promise<PromoCode> {
    return await req("/admin/promo-codes", { method: "PUT", body: JSON.stringify(payload) });
  },
  async deletePromoCode(code: string) {
    return await req(`/admin/promo-codes/${encodeURIComponent(code)}`, { method: "DELETE" });
  },
  async stats(): Promise<AdminStats> {
    return await req("/admin/stats");
  },
  async userSummary(id: number): Promise<UserActivity> {
    return await req(`/admin/users/${id}/summary`);
  },
  /** days: N for a while, null for good, 0 to lift the block. */
  async banUser(id: number, days: number | null): Promise<{ is_banned: boolean; banned_until: string | null }> {
    return await req(`/admin/users/${id}/ban`, { method: "POST", body: JSON.stringify({ days }) });
  },
  /** Channel moderation; the backend only allows it to members (staff) of that conversation. */
  async moderateMember(conversationId: number, userId: number, action: ModerateAction, minutes = 60) {
    return await req(`/conversations/${conversationId}/members/${userId}/moderate`, {
      method: "POST",
      body: JSON.stringify({ action, minutes }),
    });
  },
  /** EventSource cannot send headers, so the administrator token goes in the query string. */
  composeLogsUrl() {
    return `${API_BASE}/admin/compose-logs?token=${encodeURIComponent(getToken())}`;
  },
  /** Status of the logs endpoint after the EventSource failed (404 = DEBUG_COMPOSE_LOGS off). */
  async composeLogsProbe(): Promise<{ status: number; detail: string }> {
    const ctrl = new AbortController();
    try {
      const res = await fetch(api.composeLogsUrl(), { signal: ctrl.signal });
      if (res.ok) {
        ctrl.abort(); // a stream: only the status was needed
        return { status: res.status, detail: "" };
      }
      const parsed = safeJsonParse(await res.text());
      return { status: res.status, detail: typeof parsed?.detail === "string" ? parsed.detail : "" };
    } catch {
      return { status: 0, detail: "" };
    }
  },
};

// ---- Types of the administration endpoints ----

export type Plan = {
  kind: "free" | "none" | "gift" | "web" | "play";
  source?: string | null;
  plan?: string | null;
  status?: string | null;
  until?: string | null;
};

export type UserSummary = { id: number; display_name: string; avatar_url?: string | null };

export type Attachment = {
  id: number;
  file_name: string;
  mime: string;
  size: number;
  width?: number | null;
  height?: number | null;
  url: string;
  thumb_url?: string | null;
};

export type ReportStatus = "open" | "dismissed" | "actioned";

export type Report = {
  id: number;
  reason: string;
  details?: string | null;
  status: ReportStatus;
  created_at: string;
  reporter: UserSummary | null;
  message: {
    id: number;
    conversation_id: number;
    sender: UserSummary | null;
    body: string;
    original_body?: string | null;
    deleted: boolean;
    created_at: string;
    attachments: Attachment[];
  } | null;
};

export type BillingInfo = {
  enabled: boolean;
  trial_days: number;
  stripe: { configured: boolean; webhook_configured: boolean; prices: Record<string, string>; webhook_url: string };
  play: { package: string; product: string; configured: boolean; store_url: string };
  fcm: { configured: boolean; project_id?: string | null };
  counts: { gift: number; web: number; play: number };
};

export type BillingUpdate = {
  enabled?: boolean;
  trial_days?: number;
  stripe?: { secret?: string; webhook?: string };
  play?: { package?: string; product?: string; store_url?: string; service_account?: string };
  fcm?: { service_account: string };
};

export type PromoCode = {
  code: string;
  aliases: string[];
  duration: string;
  max: number | null;
  used: number;
  left: number | null;
  public: boolean;
  expires_on: string | null;
};

export type PromoCodeIn = {
  code: string;
  aliases: string[];
  duration: string;
  max_uses: number | null;
  public: boolean;
  expires_on: string | null;
};

export type ModerateAction = "silence" | "unsilence" | "ban" | "unban" | "remove";

export type AdminStats = {
  users: { total: number; online: number; new_7d: number; active_24h: number; active_7d: number; banned: number; unverified: number; admins: number };
  signups: { day: string; count: number }[];
  activity: { messages_24h: number; messages_7d: number; communities: number; upcoming_plans: number };
  reports_open: number;
  plans: { gift: number; web: number; play: number };
  provinces: { province: string; count: number }[];
};

export type UserActivity = {
  messages: number; communities: number; groups: number; dms: number; friends: number; posts: number;
  reports_received: number; reports_made: number; online: boolean;
};
