import { useSyncExternalStore } from "react";

export type Route =
  | { name: "home" }
  | { name: "chat"; id: number; thread: number | null; panel: "members" | "info" | null; around: number | null }
  | { name: "chats" }
  | { name: "plans" }
  | { name: "publish"; community: number | null; repeat: number | null; edit: number | null }
  | { name: "post"; id: number }
  | { name: "communities" }
  | { name: "community"; id: number; tab: "board" | "chat" | "agenda" | "members" }
  | { name: "people" }
  | { name: "mentions" }
  | { name: "account" }
  | { name: "share" }
  | { name: "join"; code: string }
  | { name: "admin" };

const BASE = "/app";
const listeners = new Set<() => void>();
let current = parse();

function parse(): Route {
  const path = window.location.pathname.replace(/\/+$/, "");
  const q = new URLSearchParams(window.location.search);
  const rest = path.startsWith(BASE) ? path.slice(BASE.length) : path;
  const m = rest.match(/^\/c\/(\d+)$/);
  if (m) {
    const panel = q.get("panel");
    return {
      name: "chat",
      id: Number(m[1]),
      thread: q.get("thread") ? Number(q.get("thread")) : null,
      panel: panel === "members" || panel === "info" ? panel : null,
      around: q.get("around") ? Number(q.get("around")) : null,
    };
  }
  const p = rest.match(/^\/p\/(\d+)$/);
  if (p) return { name: "post", id: Number(p[1]) };
  const cm = rest.match(/^\/communities\/(\d+)$/);
  if (cm) {
    const tab = q.get("tab");
    return { name: "community", id: Number(cm[1]), tab: tab === "chat" || tab === "agenda" || tab === "members" ? tab : "board" };
  }
  const num = (k: string) => (q.get(k) ? Number(q.get(k)) || null : null);
  const j = rest.match(/^\/join\/([\w-]+)$/);
  if (j) return { name: "join", code: j[1] };
  switch (rest) {
    // "/explore" was the list of channels: they are communities now.
    case "/explore": case "/communities": return { name: "communities" };
    case "/chats": return { name: "chats" };
    case "/plans": return { name: "plans" };
    case "/publish": return { name: "publish", community: num("community"), repeat: num("repeat"), edit: num("edit") };
    case "/people": return { name: "people" };
    case "/mentions": return { name: "mentions" };
    case "/account": return { name: "account" };
    case "/share": return { name: "share" };
    case "/admin": return { name: "admin" };
    default: return { name: "home" };
  }
}

function emit() {
  current = parse();
  listeners.forEach((l) => l());
}

window.addEventListener("popstate", emit);

export function navigate(path: string, replace = false) {
  const url = path.startsWith("/") ? BASE + (path === "/" ? "/" : path) : path;
  if (url === window.location.pathname + window.location.search) return;
  // The marker tells goBack() that the previous entry belongs to the app.
  if (replace) window.history.replaceState(window.history.state, "", url);
  else window.history.pushState({ mg: 1 }, "", url);
  emit();
}

/** Back to the previous screen of the app, or to `fallback` when the app was opened right here. */
export function goBack(fallback = "/") {
  if (window.history.state?.mg) window.history.back();
  else navigate(fallback, true);
}

export function postPath(id: number) {
  return `/p/${id}`;
}

export function communityPath(id: number, tab?: "board" | "chat" | "agenda" | "members") {
  return `/communities/${id}${tab && tab !== "board" ? "?tab=" + tab : ""}`;
}

export function chatPath(id: number, opts: { thread?: number | null; panel?: string | null; around?: number | null } = {}) {
  const q = new URLSearchParams();
  if (opts.thread) q.set("thread", String(opts.thread));
  if (opts.panel) q.set("panel", opts.panel);
  if (opts.around) q.set("around", String(opts.around));
  const s = q.toString();
  return `/c/${id}${s ? "?" + s : ""}`;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function queryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

export function dropQueryParams(...names: string[]) {
  const url = new URL(window.location.href);
  names.forEach((n) => url.searchParams.delete(n));
  window.history.replaceState(null, "", url.pathname + url.search);
}
