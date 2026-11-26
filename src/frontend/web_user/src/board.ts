// Board helpers shared by the screens: live events, dates of plans and colours of covers.
import { getLang } from "@lang";
import type { Comment, Post } from "./types";

// ---------- live events (post.created, post.updated, post.deleted, comment.created, attendance.changed) ----------
export type BoardEvent = {
  type: "post.created" | "post.updated" | "post.deleted" | "comment.created" | "attendance.changed";
  post?: Post;
  post_id?: number;
  community_id?: number;
  comment?: Comment;
  [key: string]: unknown;
};

const boardListeners = new Set<(ev: BoardEvent) => void>();

export function onBoardEvent(cb: (ev: BoardEvent) => void) {
  boardListeners.add(cb);
  return () => {
    boardListeners.delete(cb);
  };
}

export function emitBoardEvent(ev: BoardEvent) {
  boardListeners.forEach((cb) => cb(ev));
}

/** The post an event is about, whatever shape it comes in. */
export function eventPostId(ev: BoardEvent): number | null {
  return ev.post?.id ?? ev.post_id ?? ev.comment?.post_id ?? null;
}

// ---------- dates ----------
function loc() {
  const l = getLang();
  return l === "en" ? "en-GB" : l;
}

export function isDated(p: Post) {
  return (p.kind === "meetup" || p.kind === "event") && !!p.starts_at;
}

export function isPast(p: Post) {
  if (!p.starts_at) return false;
  return new Date(p.ends_at || p.starts_at).getTime() < Date.now();
}

/** Day of the month and short weekday for the date tile. */
export function dateTile(iso: string) {
  const d = new Date(iso);
  return { day: d.getDate(), weekday: d.toLocaleDateString(loc(), { weekday: "short" }).replace(".", ""), month: d.toLocaleDateString(loc(), { month: "short" }).replace(".", "") };
}

export function hourOf(iso: string) {
  return new Date(iso).toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" });
}

/** "Sat 29 Nov, 09:00" (with the year when it is not this year). */
export function longWhen(iso: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(loc(), { weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) }) + ", " + hourOf(iso);
}

export function shortDay(iso: string) {
  return new Date(iso).toLocaleDateString(loc(), { weekday: "short", day: "numeric", month: "short" });
}

/** Hours from start to end, "09:00–14:00" when both are the same day. */
export function timeRange(p: Post) {
  if (!p.starts_at) return "";
  if (!p.ends_at) return hourOf(p.starts_at);
  const sameDay = new Date(p.starts_at).toDateString() === new Date(p.ends_at).toDateString();
  return sameDay ? `${hourOf(p.starts_at)}–${hourOf(p.ends_at)}` : `${hourOf(p.starts_at)} – ${shortDay(p.ends_at)}`;
}

/** "in 2 days", "tomorrow", "3 hours ago"... in the person's language. */
export function relative(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: "auto" });
  if (abs < 3600000) return rtf.format(Math.round(diff / 60000), "minute");
  if (abs < 86400000) return rtf.format(Math.round(diff / 3600000), "hour");
  if (abs < 30 * 86400000) return rtf.format(Math.round(diff / 86400000), "day");
  return rtf.format(Math.round(diff / (30 * 86400000)), "month");
}

/** Local date ("2026-11-29") and time ("09:00") of an ISO instant, for the date and time fields. */
export function toLocalParts(iso: string | null) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export function fromLocalParts(date: string, time: string): string | null {
  if (!date) return null;
  const d = new Date(`${date}T${time || "00:00"}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------- colours ----------
const COVERS = [
  ["#1e90ff", "#18d7c8"], ["#ff8a4c", "#ffb547"], ["#8b5cf6", "#ec4899"], ["#43d854", "#18d7c8"],
  ["#0ea5e9", "#6366f1"], ["#f43f5e", "#fb923c"], ["#14b8a6", "#3b82f6"], ["#a855f7", "#06b6d4"],
];

/** A gradient that is always the same for the same seed (community or post id). */
/** The first colour of the seed's gradient (the pastel themes tint icons with it). */
export function coverColor(seed: string | number) {
  const s = String(seed);
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return COVERS[h % COVERS.length][0];
}

export function coverGradient(seed: string | number, angle = 135) {
  const s = String(seed);
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  const [a, b] = COVERS[h % COVERS.length];
  return `linear-gradient(${angle}deg, ${a}, ${b})`;
}
