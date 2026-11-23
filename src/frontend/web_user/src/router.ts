import { useSyncExternalStore } from "react";

export type Route =
  | { name: "home" }
  | { name: "chat"; id: number; thread: number | null; panel: "members" | "info" | null; around: number | null }
  | { name: "explore" }
  | { name: "people" }
  | { name: "mentions" }
  | { name: "account" }
  | { name: "share" }
  | { name: "join"; code: string };

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
  const j = rest.match(/^\/join\/([\w-]+)$/);
  if (j) return { name: "join", code: j[1] };
  switch (rest) {
    case "/explore": return { name: "explore" };
    case "/people": return { name: "people" };
    case "/mentions": return { name: "mentions" };
    case "/account": return { name: "account" };
    case "/share": return { name: "share" };
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
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  emit();
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
