import { getLang, t } from "@lang";
import type { BillingStatus, Conversation, Interest, Me, Member, Message, Plans, UserSummary } from "./types";

function computeApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE as string | undefined;
  if (envBase) return String(envBase).replace(/\/+$/, "");
  const { protocol, hostname, port, origin } = window.location;
  if (["5173", "5172", "5179"].includes(port)) return `${protocol}//${hostname}:18000`;
  if (hostname === "meetgo.app" || hostname.endsWith(".meetgo.app")) return "https://api.meetgo.app";
  return `${origin}/api`;
}

export const API_BASE = computeApiBase();
export const WS_BASE = API_BASE.replace(/^http/, "ws");

export function fileUrl(path: string): string {
  return path.startsWith("http") ? path : API_BASE + path;
}

// ---- session token ----
const TOKEN_KEY = "token";
export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}
export function setToken(value: string) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session lasts this tab */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;
let onPaymentRequired: (() => void) | null = null;
export function setApiHandlers(handlers: { unauthorized?: () => void; paymentRequired?: () => void }) {
  onUnauthorized = handlers.unauthorized || null;
  onPaymentRequired = handlers.paymentRequired || null;
}

async function req<T = any>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Lang": getLang(), ...(opts.headers as Record<string, string> | undefined) };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { ...opts, body, headers });
  } catch {
    throw new ApiError(0, t("ui_err_network"));
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail = data && typeof data === "object" ? (data as any).detail : null;
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? t("ui_err_invalid_data") : t("ui_err_generic", { status: res.status });
    if (res.status === 401 && token) onUnauthorized?.();
    if (res.status === 402) onPaymentRequired?.();
    throw new ApiError(res.status, message);
  }
  return data as T;
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export type MessagePage = {
  messages: Message[];
  has_more_before: boolean;
  has_more_after: boolean;
  last_read_message_id: number;
  thread_root: Message | null;
};

export const api = {
  // auth
  login: (email: string, password: string) => req<{ access_token: string; password_temp: boolean }>("/auth/login", { method: "POST", json: { email, password } }),
  register: (payload: Record<string, unknown>) => req("/auth/register", { method: "POST", json: payload }),
  logout: () => req("/auth/logout", { method: "POST" }),
  verifyEmail: (token: string) => req(`/auth/verify-email?token=${encodeURIComponent(token)}`),
  forgotPassword: (email: string) => req("/auth/forgot-password", { method: "POST", json: { email } }),
  resetPassword: (token: string, new_password: string) => req("/auth/reset-password", { method: "POST", json: { token, new_password } }),
  me: () => req<Me>("/me"),
  updateProfile: (payload: Record<string, unknown>) => req<Me>("/me/profile", { method: "PATCH", json: payload }),
  publicSettings: () => req<any>("/settings/public"),
  interests: () => req<Interest[]>("/interests"),
  myInterests: () => req<string[]>("/me/interests"),
  setInterests: (slugs: string[]) => req("/me/interests", { method: "POST", json: { interest_slugs: slugs } }),
  user: (id: number) => req<any>(`/users/${id}`),
  searchUsers: (q: string) => req<any[]>(`/users/search?q=${encodeURIComponent(q)}`),

  // conversations
  conversations: () => req<Conversation[]>("/conversations"),
  conversation: (id: number) => req<Conversation>(`/conversations/${id}`),
  messages: (id: number, params: Record<string, number | undefined> = {}) => {
    const qs = Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join("&");
    return req<MessagePage>(`/conversations/${id}/messages${qs ? "?" + qs : ""}`);
  },
  send: (id: number, payload: Record<string, unknown>) => req<Message>(`/conversations/${id}/messages`, { method: "POST", json: payload }),
  editMessage: (id: number, body: string) => req<Message>(`/messages/${id}`, { method: "PATCH", json: { body } }),
  deleteMessage: (id: number) => req(`/messages/${id}`, { method: "DELETE" }),
  react: (id: number, emoji: string, on: boolean) => req(`/messages/${id}/reactions/${encodeURIComponent(emoji)}`, { method: on ? "PUT" : "DELETE" }),
  report: (id: number, reason: string, details?: string) => req(`/messages/${id}/report`, { method: "POST", json: { reason, details } }),
  read: (id: number, message_id: number) => req(`/conversations/${id}/read`, { method: "POST", json: { message_id } }),
  readState: (id: number) => req<{ user_id: number; last_read_message_id: number }[]>(`/conversations/${id}/read-state`),
  members: (id: number, q = "") => req<Member[]>(`/conversations/${id}/members${q ? "?q=" + encodeURIComponent(q) : ""}`),
  settings: (id: number, payload: { notify?: string; mute_minutes?: number; pinned?: boolean }) => req(`/conversations/${id}/settings`, { method: "PATCH", json: payload }),
  updateConversation: (id: number, payload: Record<string, unknown>) => req(`/conversations/${id}`, { method: "PATCH", json: payload }),
  createGroup: (title: string, member_ids: number[], description?: string) => req<{ id: number }>("/conversations/groups", { method: "POST", json: { title, member_ids, description } }),
  addMembers: (id: number, user_ids: number[]) => req(`/conversations/${id}/members`, { method: "POST", json: { user_ids } }),
  removeMember: (id: number, userId: number) => req(`/conversations/${id}/members/${userId}`, { method: "DELETE" }),
  setRole: (id: number, userId: number, role: string) => req(`/conversations/${id}/members/${userId}/role`, { method: "PUT", json: { role } }),
  moderate: (id: number, userId: number, action: string, minutes = 60) => req(`/conversations/${id}/members/${userId}/moderate`, { method: "POST", json: { action, minutes } }),
  newInvite: (id: number) => req<{ invite_code: string }>(`/conversations/${id}/invite`, { method: "POST" }),
  joinInvite: (code: string) => req<{ conversation_id: number }>(`/conversations/join/${encodeURIComponent(code)}`, { method: "POST" }),
  openDm: (user_id: number) => req<{ conversation_id?: number; request_id?: number; status?: string }>("/conversations/dm", { method: "POST", json: { user_id } }),
  dmRequests: () => req<{ id: number; from_user: UserSummary; created_at: string }[]>("/dm/requests"),
  resolveDm: (id: number, accept: boolean) => req<{ conversation_id: number | null }>(`/dm/requests/${id}/resolve`, { method: "POST", json: { accept } }),
  explore: () => req<{ interest: { id: number; slug: string; name: string }; conversation_id: number | null; member_count: number; joined: boolean; zone: string }[]>("/channels/explore"),
  joinChannel: (interestId: number) => req<{ conversation_id: number }>(`/channels/${interestId}/join`, { method: "POST" }),
  search: (q: string, conversationId?: number) => req<Message[]>(`/search/messages?q=${encodeURIComponent(q)}${conversationId ? "&conversation_id=" + conversationId : ""}`),
  mentions: () => req<Message[]>("/mentions"),
  upload: (file: File | Blob, name?: string) => {
    const form = new FormData();
    form.append("file", file, name || (file as File).name || "fichero");
    return req<any>("/uploads", { method: "POST", body: form });
  },
  ticket: () => req<{ ticket: string }>("/realtime/ticket", { method: "POST" }),

  // social
  friends: () => req<(UserSummary & { online: boolean })[]>("/friends"),
  removeFriend: (id: number) => req(`/friends/${id}`, { method: "DELETE" }),
  friendRequest: (to_user_id: number) => req<any>("/friends/requests", { method: "POST", json: { to_user_id } }),
  friendRequests: () => req<any[]>("/friends/requests/incoming"),
  resolveFriend: (id: number, accept: boolean) => req(`/friends/requests/${id}/resolve`, { method: "POST", json: { accept } }),
  follow: (id: number) => req(`/follow/${id}`, { method: "POST" }),
  unfollow: (id: number) => req(`/follow/${id}`, { method: "DELETE" }),
  following: () => req<number[]>("/following"),
  feed: () => req<any[]>("/feed?limit=50"),
  post: (content: string) => req("/posts", { method: "POST", json: { content } }),

  // push
  pushConfig: () => req<{ webpush_public_key: string | null; fcm_enabled: boolean }>("/push/config"),
  registerDevice: (kind: "fcm" | "webpush", token: string, keys: Record<string, string> = {}) => req("/devices", { method: "POST", json: { kind, token, keys } }),
  removeDevice: (kind: "fcm" | "webpush", token: string) => req("/devices/remove", { method: "POST", json: { kind, token } }),

  // billing
  plans: () => req<Plans>("/billing/plans"),
  billing: () => req<BillingStatus>("/billing/status"),
  redeem: (code: string) => req<BillingStatus>("/billing/redeem", { method: "POST", json: { code } }),
  checkout: (plan: string) => req<{ url: string }>("/billing/stripe/checkout", { method: "POST", json: { plan } }),
  complete: (session_id: string) => req<BillingStatus>("/billing/stripe/complete", { method: "POST", json: { session_id } }),
  portal: () => req<{ url: string }>("/billing/stripe/portal", { method: "POST" }),
  cancelPlan: () => req<BillingStatus>("/billing/stripe/cancel", { method: "POST" }),
  resumePlan: () => req<BillingStatus>("/billing/stripe/resume", { method: "POST" }),
  changePlan: (plan: string) => req<BillingStatus>("/billing/stripe/change", { method: "POST", json: { plan } }),
  playLink: (token: string, product?: string) => req<BillingStatus>("/billing/play/link", { method: "POST", json: { token, product } }),
};
