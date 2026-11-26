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
  async business(period: string, refresh = false): Promise<Business> {
    return await req(`/admin/business?period=${period}${refresh ? "&refresh=true" : ""}`);
  },
  async businessTest(source: "stripe" | "play" | "reports" | "fcm" | "smtp"): Promise<{ ok: boolean; detail: string }> {
    return await req("/admin/business/test", { method: "POST", body: JSON.stringify({ source }) });
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
  async ai(): Promise<AiStatus> {
    return await req("/admin/ai");
  },
  async saveAi(payload: { api_key?: string; model?: string; clear?: boolean }): Promise<AiStatus> {
    return await req("/admin/ai", { method: "PUT", body: JSON.stringify(payload) });
  },
  async testAi(): Promise<{ ok: boolean; error?: string }> {
    return await req("/admin/ai/test", { method: "POST" });
  },
  async languages(): Promise<AdminLanguage[]> {
    return await req("/admin/languages");
  },
  async addLanguage(code: string, name: string): Promise<AdminLanguage[]> {
    return await req("/admin/languages", { method: "POST", body: JSON.stringify({ code, name }) });
  },
  async completeLanguage(code: string): Promise<AdminLanguage[]> {
    return await req(`/admin/languages/${encodeURIComponent(code)}/translate`, { method: "POST" });
  },
  async editLanguage(code: string, payload: { enabled?: boolean; name?: string }): Promise<AdminLanguage[]> {
    return await req(`/admin/languages/${encodeURIComponent(code)}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  async deleteLanguage(code: string): Promise<AdminLanguage[]> {
    return await req(`/admin/languages/${encodeURIComponent(code)}`, { method: "DELETE" });
  },
  async adminCategories(): Promise<AdminCategories> {
    return await req("/admin/categories");
  },
  async createCategory(payload: { names: Record<string, string>; position?: number }) {
    return await req("/admin/categories", { method: "POST", body: JSON.stringify(payload) });
  },
  async updateCategory(key: string, payload: { names?: Record<string, string>; position?: number }) {
    return await req(`/admin/categories/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  async deleteCategory(key: string) {
    return await req(`/admin/categories/${encodeURIComponent(key)}`, { method: "DELETE" });
  },
  async assignCategory(payload: { key: string; community_ids: number[]; interest_ids: number[] }): Promise<{ changed: number }> {
    return await req("/admin/categories/assign", { method: "POST", body: JSON.stringify(payload) });
  },
  async approveProposal(id: number, payload: { names?: Record<string, string>; key?: string }) {
    return await req(`/admin/categories/proposals/${id}/approve`, { method: "POST", body: JSON.stringify(payload) });
  },
  async rejectProposal(id: number) {
    return await req(`/admin/categories/proposals/${id}/reject`, { method: "POST" });
  },
  async adminInterests(): Promise<AdminInterest[]> {
    return await req("/admin/interests");
  },
  async stats(): Promise<AdminStats> {
    return await req("/admin/stats");
  },
  // ---- backups (Administration → Backups) ----
  async backups(): Promise<BackupsStatus> {
    return await req("/admin/backups");
  },
  async saveBackupSettings(settings: BackupSettings): Promise<BackupsStatus> {
    return await req("/admin/backups/settings", { method: "PUT", body: JSON.stringify(settings) });
  },
  async backupFiles(path: string): Promise<BackupFile[]> {
    return await req(`/admin/backups/files?path=${encodeURIComponent(path)}`);
  },
  async backupDirs(path: string): Promise<{ path: string; root: string; parent: string | null; dirs: string[] }> {
    return await req(`/admin/backups/dirs?path=${encodeURIComponent(path)}`);
  },
  async newBackupDir(path: string, name: string): Promise<{ path: string; root: string; parent: string | null; dirs: string[] }> {
    return await req("/admin/backups/dirs", { method: "POST", body: JSON.stringify({ path, name }) });
  },
  async runBackup(level: "full" | "light"): Promise<BackupTask> {
    return await req("/admin/backups/run", { method: "POST", body: JSON.stringify({ level }) });
  },
  async backupTask(id: string): Promise<BackupTask> {
    return await req(`/admin/backups/task/${id}`);
  },
  async inspectBackup(path: string, name: string): Promise<BackupManifest> {
    return await req("/admin/backups/inspect", { method: "POST", body: JSON.stringify({ path, name }) });
  },
  async restoreBackup(path: string, name: string, parts: string[]): Promise<BackupTask> {
    return await req("/admin/backups/restore", { method: "POST", body: JSON.stringify({ path, name, parts }) });
  },
  async deleteBackup(path: string, name: string) {
    return await req("/admin/backups/delete", { method: "POST", body: JSON.stringify({ path, name }) });
  },
  /** A link valid 10 minutes, for the browser to download the ZIP. */
  async backupDownloadUrl(path: string, name: string): Promise<string> {
    const { token } = await req("/admin/backups/download-link", { method: "POST", body: JSON.stringify({ path, name }) });
    return `${API_BASE}/admin/backups/download?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`;
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
  stripe: { configured: boolean; webhook_configured: boolean; prices: Record<string, string>; webhook_url: string; secret_ends?: string | null; webhook_ends?: string | null };
  play: { package: string; product: string; configured: boolean; store_url: string; account?: string | null; reports_bucket?: string };
  fcm: { configured: boolean; project_id?: string | null; account?: string | null };
  counts: { gift: number; web: number; play: number };
};

export type BillingUpdate = {
  enabled?: boolean;
  trial_days?: number;
  stripe?: { secret?: string; webhook?: string };
  play?: { package?: string; product?: string; store_url?: string; service_account?: string; reports_bucket?: string };
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
  reports_received: number; reports_made: number; online: boolean; connected_seconds?: number;
};

export type AiStatus = { configured: boolean; source: "panel" | "env" | ""; hint: string; model: string; models: string[] };

export type AdminLanguage = {
  code: string; name: string; builtin: boolean; enabled: boolean; translated: number; total: number;
  job: { done: number; total: number; state: "running" | "done" | "error"; error: string } | null;
};

export type AdminInterest = {
  base_name?: string; names?: Record<string, string>;
  id: number; slug: string; name: string; category: string | null; icon: string | null; color: string | null;
  age_ranges: string[]; active: boolean; zones: number; people: number;
  tags: string[]; min_age: number | null; max_age: number | null; access_mode: "open" | "request"; board_mode: "open" | "admins";
  retention_days: number; join_questions: string[];
};

export type BackupSettings = {
  enabled: boolean; recurrence: "hourly" | "every_4_hours" | "daily" | "weekly" | "monthly"; weekly_day: number; monthly_day: number;
  execution_time: string; light_backups: boolean; full_backup_day: number; keep_days: number; keep_weeks: number; keep_months: number;
  components: string[]; backup_path: string;
};
export type BackupFile = { name: string; level: "full" | "light"; origin: "manual" | "scheduled" | "prerestore"; size: number; created_at: string };
export type BackupTask = { id: string; kind: "backup" | "restore"; state: "running" | "done" | "error"; step: string; progress: number; message: string; file: string };
export type BackupManifest = {
  created_at?: string; level?: string; origin?: string; by?: string; alembic?: string; components?: string[];
  has_database: boolean; has_files: boolean; file_count: number; table_count: number;
};
export type BackupsStatus = {
  settings: BackupSettings; root: string; default_path: string; backups: BackupFile[]; task: BackupTask | null;
  status: {
    count: number; size: number; count_full: number; count_light: number; size_full: number; size_light: number;
    latest_full: number | null; latest_light: number | null; disk: { free: number; total: number; used: number; low: boolean };
    last_success: string | null; last_level: string | null; next_run: string | null; next_level: string | null; problem: string | null;
  };
};

/** Administration → Business: each block says where it comes from and when ("unconfigured" or "error" otherwise). */
export type Source = { source: string; state: "ok" | "unconfigured" | "error"; updated_at?: string | null; error?: string };
export type Point = { label: string; value: number };
export type Business = {
  period: string; generated_at: string;
  users: Source & { total: number; new: number; active_7d: number; active_30d: number; series: Point[] };
  subscriptions: Source & {
    enabled: boolean; trial_days: number; paid: number; trialing: number; ended: number; read_only: number;
    by_plan: { monthly: number; yearly: number }; by_channel: { web: number; play: number };
    gifts: { total: number; promo: number; admin: number }; free_legacy: number;
    promos: { code: string; used: number; max: number | null; left: number | null; public: boolean; expires_on: string | null }[];
    launch: { code: string; used: number; max: number | null; left: number | null } | null;
    mrr: { total: number; web: number; play: number };
  };
  revenue: {
    mrr: Source & { total: number; web: number; play: number };
    stripe: Source & { collected?: number; refunded?: number; net?: number; trials_ended?: number; converted?: number; conversion?: number | null; cancelled?: number };
    stripe_series: Point[];
    play: Source & { until?: string | null; currency?: string; period?: number; months?: Record<string, number> };
  };
  downloads: {
    apk: Source & { total: number; period: number; since: string | null; series: Point[] };
    play: Source & { until?: string | null; period?: number; total?: number; series?: Point[] };
  };
  play: { package: string; tracks: Source & { items?: { track: string; name: string | null; codes: string[]; status: string }[] } };
  health: Source & {
    backup: { last_success?: string | null; level?: string | null; problem?: string | null };
    mail: { configured: boolean; ok?: boolean; at?: string; error?: string | null };
    disk: { free: number; total: number; low: boolean } | null;
  };
};

export type AdminCategory = { key: string; name: string; names: Record<string, string>; position: number; builtin: boolean; count: number };
export type AdminCategories = {
  categories: AdminCategory[];
  proposals: { id: number; name: string; created_at: string; user: { id: number; name: string } | null; community: { id: number; title: string } | null }[];
  communities: { id: number; title: string; kind: "custom"; category: string | null; province: string | null; members: number; created_at: string | null }[];
  interests: { id: number; title: string; kind: "interest"; category: string | null; slug: string }[];
};
