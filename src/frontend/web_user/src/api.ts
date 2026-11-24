import { getLang, t } from "@lang";
import type {
  Attendee, BillingStatus, Comment, Community, CommunityMember, Conversation, FeedFilter, Interest, Me, Member, Message, Plans, Post,
  PostPage, UserSummary,
} from "./types";

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

// While a MeetGo administrator uses a bot account, their own session waits here.
const OWNER_TOKEN_KEY = "owner_token";
export function ownerToken(): string {
  try {
    return localStorage.getItem(OWNER_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}
export function actAs(botToken: string) {
  try {
    if (!ownerToken()) localStorage.setItem(OWNER_TOKEN_KEY, getToken());
  } catch {
    /* without storage the switch lasts this tab */
  }
  setToken(botToken);
}
export function backToOwner() {
  const own = ownerToken();
  try {
    localStorage.removeItem(OWNER_TOKEN_KEY);
  } catch {
    /* nothing to clean */
  }
  if (own) setToken(own);
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

function qs(params: Record<string, string | number | undefined | null>): string {
  const q = Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return q ? "?" + q : "";
}

export const api = {
  // auth
  login: (email: string, password: string) => req<{ access_token: string; password_temp: boolean }>("/auth/login", { method: "POST", json: { email, password } }),
  register: (payload: Record<string, unknown>) => req("/auth/register", { method: "POST", json: payload }),
  logout: () => req("/auth/logout", { method: "POST" }),
  verifyEmail: (token: string) => req(`/auth/verify-email?token=${encodeURIComponent(token)}`),
  forgotPassword: (email: string) => req("/auth/forgot-password", { method: "POST", json: { email } }),
  resendVerification: (email: string) => req("/auth/resend-verification", { method: "POST", json: { email } }),
  resetPassword: (token: string, new_password: string) => req("/auth/reset-password", { method: "POST", json: { token, new_password } }),
  me: () => req<Me>("/me"),
  updateProfile: (payload: Record<string, unknown>) => req<Me>("/me/profile", { method: "PATCH", json: payload }),
  emailPrefs: (payload: Record<string, boolean>) => req<Me>("/me/email-prefs", { method: "PATCH", json: payload }),
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
  // my photo: cropped square by the server, at a fixed address
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file, file.name || "avatar.jpg");
    return req<Me>("/me/avatar", { method: "POST", body: form });
  },
  deleteAvatar: () => req<Me>("/me/avatar", { method: "DELETE" }),
  deleteMe: (password: string) => req("/me", { method: "DELETE", json: { password } }),
  blocks: () => req<(UserSummary & { blocked_at: string })[]>("/me/blocks"),
  block: (userId: number) => req(`/users/${userId}/block`, { method: "POST" }),
  unblock: (userId: number) => req(`/users/${userId}/block`, { method: "DELETE" }),
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

  // communities
  communities: (params: { q?: string; mine?: boolean } = {}) => req<Community[]>(`/communities${qs({ q: params.q, mine: params.mine ? 1 : undefined })}`),
  community: (id: number) => req<Community>(`/communities/${id}`),
  createCommunity: (payload: { title: string; description?: string; avatar_url?: string; access_mode: string; board_mode: string }) => req<Community>("/communities", { method: "POST", json: payload }),
  updateCommunity: (id: number, payload: Record<string, unknown>) => req<Community>(`/communities/${id}`, { method: "PATCH", json: payload }),
  joinCommunity: (id: number) => req<{ status: "joined" | "requested" }>(`/communities/${id}/join`, { method: "POST" }),
  joinCommunityCode: (code: string) => req<{ status: "joined"; community_id: number }>(`/communities/join/${encodeURIComponent(code)}`, { method: "POST" }),
  communityInvite: (id: number) => req<{ code: string; url: string }>(`/communities/${id}/invite`, { method: "POST" }),
  leaveCommunity: (id: number) => req(`/communities/${id}/membership`, { method: "DELETE" }),
  communityRequests: (id: number) => req<{ user: UserSummary; created_at: string }[]>(`/communities/${id}/requests`),
  resolveCommunityRequest: (id: number, userId: number, accept: boolean) => req(`/communities/${id}/requests/${userId}/resolve`, { method: "POST", json: { accept } }),
  communityMembers: (id: number, q = "") => req<CommunityMember[]>(`/communities/${id}/members${qs({ q })}`),
  setCommunityRole: (id: number, userId: number, role: string) => req(`/communities/${id}/members/${userId}/role`, { method: "PUT", json: { role } }),
  banCommunityMember: (id: number, userId: number, hours: number | null) => req(`/communities/${id}/members/${userId}/ban`, { method: "POST", json: { hours } }),
  unbanCommunityMember: (id: number, userId: number) => req(`/communities/${id}/members/${userId}/unban`, { method: "POST" }),
  clearCommunityChat: (id: number) => req(`/communities/${id}/clear-chat`, { method: "POST" }),
  communityBans: (id: number) => req<{ user: UserSummary; forever: boolean; until: string | null; strikes: number }[]>(`/communities/${id}/bans`),
  // MeetGo administration (administrators only)
  adminBots: () => req<(UserSummary & { bot_role: string })[]>("/admin/bots"),
  adminAutomod: () => req<{ enabled: boolean; model: string }>("/admin/automod"),
  adminBotSession: (id: number) => req<{ access_token: string }>(`/admin/bots/${id}/session`, { method: "POST" }),
  removeCommunityMember: (id: number, userId: number, ban = false) => req(`/communities/${id}/members/${userId}${ban ? "?ban=1" : ""}`, { method: "DELETE" }),

  // board and plans
  boardFeed: (f: FeedFilter = {}) => req<PostPage>(`/board/feed${qs(f)}`),
  communityPosts: (id: number, f: FeedFilter = {}) => req<PostPage>(`/communities/${id}/posts${qs({ ...f, community_id: undefined })}`),
  createPost: (communityId: number, payload: Record<string, unknown>) => req<Post>(`/communities/${communityId}/posts`, { method: "POST", json: payload }),
  boardPost: (id: number) => req<Post>(`/posts/${id}`),
  updatePost: (id: number, payload: Record<string, unknown>) => req<Post>(`/posts/${id}`, { method: "PATCH", json: payload }),
  deletePost: (id: number) => req(`/posts/${id}`, { method: "DELETE" }),
  attend: (id: number) => req<{ status: "going" | "waitlist" | "pending" }>(`/posts/${id}/attend`, { method: "POST" }),
  unattend: (id: number) => req(`/posts/${id}/attend`, { method: "DELETE" }),
  attendees: (id: number) => req<Attendee[]>(`/posts/${id}/attendees`),
  resolveAttendee: (id: number, userId: number, accept: boolean) => req(`/posts/${id}/attendees/${userId}/resolve`, { method: "POST", json: { accept } }),
  comments: (id: number, beforeId?: number) => req<{ comments: Comment[]; has_more: boolean }>(`/posts/${id}/comments${qs({ before_id: beforeId })}`),
  addComment: (id: number, body: string) => req<Comment>(`/posts/${id}/comments`, { method: "POST", json: { body } }),
  deleteComment: (id: number) => req(`/comments/${id}`, { method: "DELETE" }),
  reportPost: (id: number, reason: string, details?: string) => req(`/posts/${id}/report`, { method: "POST", json: { reason, details } }),
  myPlans: (when: "upcoming" | "past" | "organizing") => req<Post[]>(`/me/plans?when=${when}`),

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
