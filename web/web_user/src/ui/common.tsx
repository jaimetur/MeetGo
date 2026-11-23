import React, { useEffect, useRef } from "react";
import { t } from "@lang";
import { fileUrl } from "../api";
import type { Conversation, UserSummary } from "../types";
import { colorFor, initials } from "../util";

const PATHS: Record<string, string> = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.5 16.5 21 21",
  chat: "M4 5h16v11H10l-5 4v-4H4z",
  compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z",
  users: "M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2c2.2.7 3.5 2.6 3.5 5.8",
  at: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",
  user: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-4 3.6-7 8-7s8 3 8 7",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21a2 2 0 0 0 4 0",
  belloff: "M6 16v-5a6 6 0 0 1 9.5-4.9M18 11v5l2 2H8M10 21a2 2 0 0 0 4 0M3 3l18 18",
  thread: "M4 5h16v10h-9l-5 4v-4H4zM8 9h8M8 12h5",
  attach: "m20.5 11.5-8.4 8.4a5 5 0 0 1-7-7l9-9a3.4 3.4 0 0 1 4.8 4.8l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3",
  smile: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2M9 9.5h.01M15 9.5h.01",
  send: "M4 12 20 4l-6 16-2.5-6.5z",
  reply: "M10 7 4 12l6 5M4 12h10a6 6 0 0 1 6 6v1",
  pin: "M12 16v5M8 3h8l-1.2 6 3.2 4H6l3.2-4z",
  back: "m15 5-7 7 7 7",
  more: "M12 5h.01M12 12h.01M12 19h.01",
  x: "M6 6l12 12M18 6 6 18",
  shield: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6zM9 12l2 2 4-4",
  check2: "m2 13 4 4 8-9M10 16l1 1 9-10",
  check: "m5 12 5 5 9-10",
  copy: "M8 8h12v12H8zM16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  plus: "M12 5v14M5 12h14",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  down: "m6 9 6 6 6-6",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  star: "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.2 9.5l6.1-.9z",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1",
};

export function Icon({ name, size, className }: { name: string; size?: "sm"; className?: string }) {
  return (
    <svg className={`ic${size ? " " + size : ""}${className ? " " + className : ""}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name] || ""} strokeWidth={name === "more" ? 3 : undefined} />
    </svg>
  );
}

export function Avatar({ user, size = 38, online }: { user: UserSummary | null | undefined; size?: number; online?: boolean }) {
  const name = user?.display_name || "?";
  return (
    <div className="av" style={{ width: size, height: size, background: user?.avatar_url ? "transparent" : colorFor(user?.id ?? name), fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {user?.avatar_url ? <img src={fileUrl(user.avatar_url)} alt="" /> : initials(name)}
      {online ? <span className="dot" /> : null}
    </div>
  );
}

export function ConvIcon({ conv, size = 40 }: { conv: Conversation; size?: number }) {
  if (conv.kind === "dm") return <Avatar user={conv.other_user} size={size} online={conv.other_user?.online} />;
  if (conv.kind === "channel") {
    const color = colorFor(conv.slug || conv.id);
    return (
      <div className="chan" style={{ width: size, height: size, fontSize: size * 0.45, color, background: `color-mix(in srgb, ${color} 15%, transparent)` }} aria-hidden="true">#</div>
    );
  }
  if (conv.avatar_url) return <Avatar user={{ id: conv.id, display_name: conv.title, avatar_url: conv.avatar_url }} size={size} />;
  const small = Math.round(size * 0.66);
  const words = conv.title.split(/\s+/);
  return (
    <div className="grp" style={{ width: size, height: size }} aria-hidden="true">
      <Avatar user={{ id: conv.id, display_name: words[0] || "G" }} size={small} />
      <Avatar user={{ id: conv.id + 7, display_name: words[1] || words[0] || "G" }} size={small} />
    </div>
  );
}

export function convTitle(conv: Conversation): string {
  return conv.kind === "channel" ? `#${conv.slug || conv.title}` : conv.title;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <span className="grow">{title}</span>
          <button className="iconbtn" onClick={onClose} aria-label={t("ui_close")}><Icon name="x" /></button>
        </header>
        <div className="mbody">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  );
}

export function useClickOutside(ref: React.RefObject<HTMLElement>, onOutside: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [ref, onOutside, active]);
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
export const EMOJIS = ["😀", "😂", "😊", "😍", "😎", "🤔", "😅", "😢", "😮", "😡", "👍", "👎", "👏", "🙌", "🙏", "💪", "❤️", "🔥", "🎉", "✨", "☕", "🍻", "🥾", "🚴", "🎾", "⚽", "🏖️", "🎬", "📍", "📅", "✅", "❓"];
