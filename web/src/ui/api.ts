// api.ts
// const API_BASE = (import.meta as any).env.VITE_API_BASE || "http://localhost:8000";
const API_BASE =
  (import.meta as any).env.VITE_API_BASE ||
  `${window.location.protocol}//${window.location.hostname}:18000`;

export type Token = { access_token: string };

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

// ---- Token helpers ----
export function getToken(): string {
  return localStorage.getItem("token") || "";
}
export function setToken(t: string) {
  localStorage.setItem("token", t);
}
export function clearToken() {
  localStorage.removeItem("token");
}

// ---- Error type that preserves HTTP info ----
export class ApiError extends Error {
  status: number;
  url: string;
  method: string;
  bodyText?: string;

  constructor(args: { status: number; url: string; method: string; message: string; bodyText?: string }) {
    super(args.message);
    this.name = "ApiError";
    this.status = args.status;
    this.url = args.url;
    this.method = args.method;
    this.bodyText = args.bodyText;
  }
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

  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url = API_BASE + path;
  const method = (opts.method || "GET").toUpperCase();

  const started = performance.now();
  let res: Response;

  try {
    res = await fetch(url, { ...opts, headers });
  } catch (e: any) {
    // network error (DNS, CORS blocking, connection refused, etc.)
    frontError(`[API] ${method} ${url} NETWORK_ERROR`, { error: e?.message || String(e) });
    throw new ApiError({
      status: 0,
      url,
      method,
      message: `NETWORK_ERROR ${e?.message || String(e)}`,
    });
  } finally {
    const tookMs = Math.round(performance.now() - started);
    // you can log latency here if you want
  }

  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  if (!res.ok) {
    // Log to frontend logger
    const parsed = safeJsonParse(text);
    frontError(`[API] ${method} ${path} -> ${res.status}`, {
      url,
      status: res.status,
      response: parsed ?? text,
    });

    // Build a compact, useful error message
    const detail = parsed?.detail ? String(parsed.detail) : (text || res.statusText);
    throw new ApiError({
      status: res.status,
      url,
      method,
      message: `${res.status} ${detail}`,
      bodyText: text,
    });
  }

  // success
  if (ct.includes("application/json")) return safeJsonParse(text) ?? {};
  return text;
}

export const api = {
  API_BASE,

  async register(payload: any) {
    return await req("/auth/register", { method: "POST", body: JSON.stringify(payload) });
  },

  async login(payload: any) {
    return await req("/auth/login", { method: "POST", body: JSON.stringify(payload) });
  },
  async logout() {
    return await req("/auth/logout", { method: "POST" });
  },
  async verifyEmail(token: string) {
    const qs = encodeURIComponent(token);
    return await req(`/auth/verify-email?token=${qs}`);
  },
  async forgotPassword(email: string) {
    return await req("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
  },
  async resetPassword(token: string, new_password: string) {
    return await req("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, new_password }) });
  },
  async publicSettings() {
    return await req("/settings/public");
  },

  async me() {
    return await req("/me");
  },

  async updateProfile(payload: any) {
    return await req("/me/profile", { method: "PATCH", body: JSON.stringify(payload) });
  },

  async listInterests() {
    return await req("/interests");
  },
  async roomsOnline() {
    return await req("/rooms/online");
  },
  async roomOnline(roomId: number) {
    return await req(`/rooms/${roomId}/online`);
  },

  async setInterests(slugs: string[]) {
    return await req("/me/interests", { method: "POST", body: JSON.stringify({ interest_slugs: slugs }) });
  },

  async myRooms() {
    return await req("/rooms/my");
  },

  // Create (or fetch) a room for the selected interest in your province & age-range
  async joinRoom(interest_slug: string) {
    // If your backend is actually /rooms/join-room or /api/rooms/join, this will 404 and you'll see it in Debug panel.
    return await req("/rooms/join", { method: "POST", body: JSON.stringify({ interest_slug }) });
  },

  async leaveRoom(room_id: number) {
    return await req("/rooms/leave", { method: "POST", body: JSON.stringify({ room_id }) });
  },

  async roomMessages(roomId: number) {
    return await req(`/rooms/${roomId}/messages?limit=50`);
  },

  async getUser(userId: number) {
    return await req(`/users/${userId}`);
  },

  async follow(userId: number) {
    return await req(`/follow/${userId}`, { method: "POST" });
  },

  async unfollow(userId: number) {
    return await req(`/follow/${userId}`, { method: "DELETE" });
  },

  async friendRequest(to_user_id: number) {
    return await req(`/friends/requests`, { method: "POST", body: JSON.stringify({ to_user_id }) });
  },

  async incomingFriendRequests() {
    return await req(`/friends/requests/incoming`);
  },

  async resolveFriendRequest(id: number, accept: boolean) {
    return await req(`/friends/requests/${id}/resolve`, { method: "POST", body: JSON.stringify({ accept }) });
  },

  async createPost(content: string) {
    return await req(`/posts`, { method: "POST", body: JSON.stringify({ content }) });
  },

  async feed() {
    return await req(`/feed?limit=50`);
  },
};
