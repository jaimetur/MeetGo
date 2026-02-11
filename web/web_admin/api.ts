import { getLang } from "../lang/lang";

function computeApiBase() {
  const envBase = (import.meta as any).env.VITE_API_BASE;
  if (envBase) return String(envBase).replace(/\/+$/, "");
  const { protocol, host, hostname, port } = window.location;
  const isDev = port === "5173" || port === "5172";
  if (isDev) return `${protocol}//${hostname}:18000`;
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
  return localStorage.getItem("admin_token") || "";
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
    throw new Error(text || res.statusText);
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
};
