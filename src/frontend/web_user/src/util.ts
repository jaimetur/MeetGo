import { getLang, t } from "@lang";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6"];

export function colorFor(seed: string | number): string {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function initials(name: string): string {
  const parts = (name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || parts[0]?.[1] || "")).toUpperCase();
}

function locale() {
  return getLang() === "en" ? "en-GB" : "es-ES";
}

export function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (dayKey(iso) === dayKey(today.toISOString())) return t("ui_today");
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t("ui_yesterday");
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "12:41", "ayer", "lun" or "3 nov" for the conversation list. */
export function shortWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(iso) === dayKey(now.toISOString())) return timeOf(iso);
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days < 1 || dayKey(iso) === dayKey(new Date(Date.now() - 86400000).toISOString())) return t("ui_yesterday").toLowerCase();
  if (days < 7) return d.toLocaleDateString(locale(), { weekday: "short" });
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function euros(cents: number): string {
  return (cents / 100).toLocaleString(locale(), { style: "currency", currency: "EUR", minimumFractionDigits: cents % 100 ? 2 : 0 });
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
const MENTION_RE = /(@[\p{L}][\p{L}\p{N}_.-]*)/gu;

export type Token = { kind: "text" | "link" | "mention"; value: string };

/** Split message text into plain text, links and @mentions (rendered as React nodes, never as HTML). */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const part of text.split(URL_RE)) {
    if (!part) continue;
    if (URL_RE.test(part)) {
      out.push({ kind: "link", value: part });
      URL_RE.lastIndex = 0;
      continue;
    }
    URL_RE.lastIndex = 0;
    for (const piece of part.split(MENTION_RE)) {
      if (!piece) continue;
      out.push({ kind: piece.startsWith("@") && MENTION_RE.test(piece) ? "mention" : "text", value: piece });
      MENTION_RE.lastIndex = 0;
    }
  }
  return out;
}

export function isOnlyEmoji(text: string): boolean {
  const s = text.trim();
  return s.length > 0 && s.length <= 12 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u.test(s);
}
