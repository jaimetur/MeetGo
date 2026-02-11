const API_BASE =
  (import.meta as any).env.VITE_API_BASE ||
  `${window.location.protocol}//${window.location.hostname}:18000`;

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

async function req(path: string, opts: RequestInit = {}) {
  const headers: any = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = headers["Content-Type"] || "application/json";
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, { ...opts, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || res.statusText);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
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
