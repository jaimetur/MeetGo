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
  home: "M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5",
  calendar: "M5 6h14v14H5zM5 10h14M9 3v4M15 3v4",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  place: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  repeat: "M4 12V9a3 3 0 0 1 3-3h12l-3-3M20 12v3a3 3 0 0 1-3 3H5l3 3",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01",
  megaphone: "M4 10v4h3l7 4V6L7 10zM17 9a4 4 0 0 1 0 6",
  ticket: "M4 8a2 2 0 0 0 0 4v0a2 2 0 0 0 0 4v2h16v-2a2 2 0 0 1 0-4 2 2 0 0 1 0-4V6H4zM14 6v12",
  right: "m9 5 7 7-7 7",
  door: "M14 4H6v16h8M10 12h10M17 9l3 3-3 3",
  layers: "M12 3 3 8l9 5 9-5zM3 13l9 5 9-5",
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

/** The MeetGo wordmark with the arrow of the icon, in the brand gradients. */
export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} aria-label="MeetGo">
      <span className="m">Meet</span><span className="g">Go</span>
      <svg viewBox="0 0 30 24" aria-hidden="true" style={{ width: size * 0.95, height: size * 0.78 }}>
        <defs><linearGradient id="wmGo" x1="0" x2="1"><stop offset="0" stopColor="#43d854" /><stop offset="1" stopColor="#18d7c8" /></linearGradient></defs>
        <circle cx="3" cy="19" r="3" fill="url(#wmGo)" /><path d="M11 2 L29 12 L11 22 Z" fill="url(#wmGo)" />
      </svg>
    </span>
  );
}

/** Opening screen: icon, wordmark and tagline while the app starts. */
export function Splash({ leaving = false }: { leaving?: boolean }) {
  return (
    <div className={"splash" + (leaving ? " leaving" : "")} role="status" aria-label="MeetGo">
      <div className="splash-glow" aria-hidden="true" />
      <img className="splash-icon" src="/apple-touch-icon.png" alt="" />
      <Wordmark size={40} />
      <p className="splash-tag">{t("ui_splash_tagline")}</p>
      <span className="dots splash-dots" aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}

/** iPhone Safari only: how to install the app on the home screen (shown until dismissed). */
export function InstallHint() {
  const [show, setShow] = React.useState(() => {
    try {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = (navigator as any).standalone || window.matchMedia("(display-mode: standalone)").matches;
      return ios && !standalone && localStorage.getItem("installHint") !== "no";
    } catch {
      return false;
    }
  });
  if (!show) return null;
  const close = () => {
    try { localStorage.setItem("installHint", "no"); } catch { /* private mode */ }
    setShow(false);
  };
  return (
    <div className="installhint" role="dialog" aria-label={t("ui_install_title")}>
      <img src="/apple-touch-icon.png" alt="" />
      <div className="grow"><b>{t("ui_install_title")}</b><div>{t("ui_install_ios")}</div></div>
      <button className="iconbtn" onClick={close} aria-label={t("ui_install_dismiss")}><Icon name="x" /></button>
    </div>
  );
}
