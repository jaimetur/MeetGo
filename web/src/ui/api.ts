// const API_BASE = (import.meta as any).env.VITE_API_BASE || "http://localhost:8000";
const API_BASE =
  (import.meta as any).env.VITE_API_BASE ||
  `${window.location.protocol}//${window.location.hostname}:18000`;

export type Token = { access_token: string };

export function getToken(): string {
  return localStorage.getItem("token") || "";
}
export function setToken(t: string) {
  localStorage.setItem("token", t);
}
export function clearToken() {
  localStorage.removeItem("token");
}

async function req(path: string, opts: RequestInit = {}) {
  const headers: any = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = headers["Content-Type"] || "application/json";
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${txt}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  return await res.text();
}

export const api = {
  API_BASE,

  async register(payload: any) {
    return await req("/auth/register", { method: "POST", body: JSON.stringify(payload) });
  },

  async login(payload: any) {
    return await req("/auth/login", { method: "POST", body: JSON.stringify(payload) });
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

  async setInterests(slugs: string[]) {
    return await req("/me/interests", { method: "POST", body: JSON.stringify({ interest_slugs: slugs }) });
  },

  async myRooms() {
    return await req("/rooms/my");
  },

  // Create (or fetch) a room for the selected interest in your province & age-range
  async joinRoom(interest_slug: string) {
    return await req("/rooms/join", { method: "POST", body: JSON.stringify({ interest_slug }) });
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
