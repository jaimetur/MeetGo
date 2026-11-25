import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { t, getLang } from "@lang";
import { fileUrl } from "../api";
import { coverGradient } from "../board";
import type { Conversation, UserSummary } from "../types";
import { colorFor, initials } from "../util";
import { useSwipeDown } from "./swipeClose";

const PATHS: Record<string, string> = {
  // hobbies (community icons)
  mountain: "M3 20h18L14.5 8l-3.5 6-2.5-3.5zM14.5 8l1.6-2.8L18 8",
  bike: "M3 16.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M14 16.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M6.5 16.5 10 9h5l2.5 7.5M10 9 8.8 6H7M14 6h2.5",
  book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8 7h8M8 10.5h6",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4",
  car: "M4 16v-3.5L6.5 7h11l2.5 5.5V16zM4 12.5h16M6.5 16v2.5M17.5 16v2.5M7.5 14.2h.01M16.5 14.2h.01",
  dumbbell: "M2.5 10v4M5.5 7v10M8.5 8.5v7M15.5 8.5v7M18.5 7v10M21.5 10v4M8.5 12h7",
  ball: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7.5l3.8 2.8-1.5 4.5H9.7l-1.5-4.5zM12 3v4.5M15.8 10.3l4.6-1.6M14.3 14.8l2.8 4M9.7 14.8l-2.8 4M8.2 10.3 3.6 8.7",
  racket: "M10 14a5.5 5.5 0 1 0 7.8-7.8A5.5 5.5 0 0 0 10 14zM10 14l-6.5 6.5M12.3 6.7l5 5M10.5 9l5 5M7.5 15.5l1.5 1.5",
  umbrella: "M3 12a9 9 0 0 1 18 0zM12 12v7a2 2 0 0 1-4 0M12 3v-1",
  beer: "M6 8h9v12H6zM15 11h2.5a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2H15M6 8a2.5 2.5 0 0 1 3.5-2.3 3 3 0 0 1 5.5 2.3M9 11.5v5.5M12 11.5v5.5",
  coffee: "M4 9h13v4.5A5.5 5.5 0 0 1 11.5 19h-2A5.5 5.5 0 0 1 4 13.5zM17 10.5h1.5a2.5 2.5 0 0 1 0 5H16.5M8 2.5c-.8 1 .8 2 0 3.5M12 2.5c-.8 1 .8 2 0 3.5M3 21.5h15",
  cocktail: "M4 4h16l-8 9.5zM12 13.5V20M8 20h8M15 4l2.5-2.5",
  plane: "M10.5 13.5 3 10.5l1.5-1.5 7.5 1 4.5-5c1-1 2.5-1 3 0s0 2-1 3l-5 4.5 1 7.5-1.5 1.5-3-7.5-3 3V20l-1.5-2.5L3 16h2.5z",
  moto: "M2.5 16a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M14.5 16a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M6 16l3.5-5h5.5l3 5M12.5 11l-1.5-4h3l2 4",
  network: "M12 3a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM5 16a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM19 16a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM12 8v4M12 12 6.5 16.5M12 12l5.5 4.5",
  basket: "M3.5 10h17l-2 10h-13zM8 10l3.5-6.5M16 10l-3.5-6.5M4.5 14.5h15M9.5 10v10M14.5 10v10",
  waves: "M2.5 15c2-2 3.5-2 5.5 0s3.5 2 5.5 0 3.5-2 5.5 0 2.2 1.3 2.5 1M2.5 19.5c2-2 3.5-2 5.5 0s3.5 2 5.5 0 3.5-2 5.5 0 2.2 1.3 2.5 1M15.5 4.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM9 11.5l3-4.5 3.5 2.5",
  trees: "M7 3l4 7H8.5l3 5h-9l3-5H3zM7 15v6M17 7.5l3.5 5.5h-2l2.5 4h-8l2.5-4h-2zM17 17v4",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0zM7 5.5H4a3 3 0 0 0 3 4M17 5.5h3a3 3 0 0 1-3 4M12 14v4M8 20.5h8M9.5 18h5",
  camera: "M3.5 7.5h4l2-3h5l2 3h4V19h-17zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z",
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0zM20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0z",
  guitar: "M11.9 12.1l4.5-4.5M20.1 2.3a1 1 0 0 0-1.4 0l-1.1 1.1A2 2 0 0 0 17 4.8v1.4a2 2 0 0 1-.6 1.4A2 2 0 0 1 17.8 7h1.4a2 2 0 0 0 1.4-.6l1.1-1.1a1 1 0 0 0 0-1.4zM6 16l2 2M8.2 9.9C8.7 8.8 9.8 8 11 8c2.8 0 5 2.2 5 5 0 1.2-.8 2.3-1.9 2.8l-.9.4A2 2 0 0 0 12 18a4 4 0 0 1-4 4c-3.3 0-6-2.7-6-6a4 4 0 0 1 4-4 2 2 0 0 0 1.8-1.2zM11.5 15.5a1 1 0 1 0 0-2a1 1 0 0 0 0 2z",
  palette: "M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.4-2-.5-1.3.4-2.5 1.8-2.5H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3zM7.5 11h.01M10 7h.01M14.5 7h.01M17 11h.01",
  paw: "M12 13c-3 0-5.5 3-5.5 5.5 0 1.5 1.5 2.5 3 2l2.5-.8 2.5.8c1.5.5 3-.5 3-2C17.5 16 15 13 12 13zM5 9.5a2 2.5 0 1 0 4 0a2 2.5 0 1 0-4 0M15 9.5a2 2.5 0 1 0 4 0a2 2.5 0 1 0-4 0M8.5 5a2 2.5 0 1 0 4 0a2 2.5 0 1 0-4 0M11.5 5a2 2.5 0 1 0 4 0a2 2.5 0 1 0-4 0",
  gamepad: "M6 8h12a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.2 2.2L14.5 14h-5l-1.3 1.7A3.5 3.5 0 0 1 2 13.5V12a4 4 0 0 1 4-4zM7 10.5v3M5.5 12h3M15.5 11.5h.01M17.5 13h.01",
  food: "M5 3v8a3 3 0 0 0 6 0V3M8 3v18M18 21V3c-2.5 1-4 3.5-4 7v4h4",
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
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M8 21h8",
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
  party: "M4 20l4-11 7 7zM8 9l7 7M13 3c.5 1.5 0 3-1.5 4M21 11c-1.5-.5-3 0-4 1.5M17 3l.01 0M20 6l.01 0M21 3l.01 0M16 8c1-1.5 2-2 3.5-2",
  dance: "M13 3.5a1.5 1.5 0 1 0 0 .01M8 21l3-6 3 2v4M5 11l4-3h5l3 4 3-1M11 15l1.5-7",
  drum: "M3 9c0-1.7 4-3 9-3s9 1.3 9 3v6c0 1.7-4 3-9 3s-9-1.3-9-3zM3 9c0 1.7 4 3 9 3s9-1.3 9-3M6 2l4 6M18 2l-4 6",
  keys: "M3 5h18v14H3zM8 12v7M13 12v7M18 12v7M6.5 5v7h3V5M11.5 5v7h3V5M16.5 5v7h3V5",
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
    const color = interestLook(conv.slug).color || colorFor(conv.slug || conv.id);
    return (
      <div className="chan" style={{ width: size, height: size, color, background: `color-mix(in srgb, ${color} 15%, transparent)` }} aria-hidden="true">
        <Icon name={hobbyIcon(conv.slug, conv.title)} />
      </div>
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

/** "Jaime Tur": first name and surnames (shown in the person's card; the alias is what the others see elsewhere). */
export function fullName(u: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  return [u?.first_name, u?.last_name].filter(Boolean).join(" ");
}

/** "Jaime (jaimetur)" from a profile, where display_name is the alias alone; the alias when there is no name. */
export function shownName(u: { display_name: string; first_name?: string | null }): string {
  return u.first_name ? `${u.first_name} (${u.display_name})` : u.display_name;
}

export function convTitle(conv: Conversation): string {
  return conv.kind === "channel" ? `#${conv.slug || conv.title}` : conv.title;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const swipe = useSwipeDown(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={swipe.style}>
        {/* dragged down by its title bar it closes (not from the body: a form's half-written fields would go) */}
        <header {...swipe.handlers}>
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

/** The brand slogan, in English in every language. */
export const SLOGAN = "Meet People, Go Places!";

/** About MeetGo: icon, wordmark, slogan, version, copyright and the legal pages. */
export function AboutModal({ onClose }: { onClose: () => void }) {
  const site = "https://www.meetgo.app";
  // on document.body: the page around it is zoomed (text size) and would trap a fixed dialog
  return createPortal(
    <Modal title={t("ui_about_title")} onClose={onClose}>
      <div className="about">
        <img className="about-icon" src="/apple-touch-icon.png" alt="" />
        <Wordmark size={34} />
        <p className="slogan">{SLOGAN}</p>
        <p className="muted">{t("ui_splash_tagline")}</p>
        <p className="about-ver">{t("ui_about_version", { version: __APP_VERSION__ })}</p>
        <nav className="about-links">
          <a href={site} target="_blank" rel="noreferrer">meetgo.app</a>
          <a href={`${site}/terms.html`} target="_blank" rel="noreferrer">{t("ui_about_terms")}</a>
          <a href={`${site}/privacy.html`} target="_blank" rel="noreferrer">{t("ui_about_privacy")}</a>
        </nav>
        <p className="muted about-copy">© {new Date().getFullYear()} MeetGo. {t("ui_about_rights")}</p>
      </div>
    </Modal>,
    document.body,
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

/** The icon that represents a community's hobby, from its slug or title (any language). */
const HOBBY_ICONS: [RegExp, string][] = [
  [/aprend|idioma|ingl[eé]s|alem[aá]n|franc[eé]s|learn|language/, "chat"], [/fiesta|party|f[eê]te|festa|feest/, "party"], [/amig|friend/, "users"],
  [/bater[ií]a|drum/, "drum"], [/teclado|keyboard|piano/, "keys"], [/baile|danc|tanz|dans/, "dance"],
  [/sender|hik|trek|monta|mountain|randonn|wander/, "mountain"], [/cicl|bici|bike|cycl|mtb|velo|rad/, "bike"],
  [/lect|libro|book|read|lectur|livre|lettur/, "book"], [/cine|film|movie|pel/, "film"], [/coche|car|auto/, "car"],
  [/moto/, "moto"], [/fitness|crossfit|gym|gimnas|muscul/, "dumbbell"], [/futbol|fútbol|football|soccer|calcio|balonc|basket/, "ball"],
  [/tenis|tennis|padel|pádel/, "racket"], [/playa|beach|plage|spiaggia/, "umbrella"], [/cerveza|beer|bière|birra|bier/, "beer"],
  [/caf[eé]|coffee/, "coffee"], [/copa|cocktail|drink|vino|wine|tomar/, "cocktail"], [/viaj|travel|voyage|viagg|reis/, "plane"],
  [/network|negocio|business|emprend/, "network"], [/picnic|pícnic/, "basket"], [/acuat|acuát|nata|surf|swim|water|kayak|vela/, "waves"],
  [/aire_libre|aire libre|outdoor|naturaleza|nature/, "trees"], [/foto|photo/, "camera"], [/concier|concert/, "ticket"], [/rock|flamenc|guitar/, "guitar"], [/m[uú]sic|music/, "music"],
  [/arte|art|pint|paint|dibuj/, "palette"], [/perro|mascot|dog|pet|gato/, "paw"], [/juego|game|videojue|gaming/, "gamepad"],
  [/cocina|comida|food|cook|gastro|tapas|cena/, "food"], [/deporte|sport/, "trophy"],
];

/** Countries in the reader's language (the name from the settings when the browser cannot say), alphabetically. */
export function countryOptions(list?: { code: string; name: string }[]): { code: string; name: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([getLang()], { type: "region" });
  } catch {
    names = null;
  }
  const out = (list && list.length ? list : [{ code: "ES", name: "España" }]).map((c) => {
    let name = c.name;
    try {
      name = (names && c.code && names.of(c.code)) || c.name;
    } catch {
      name = c.name;
    }
    return { code: c.code, name };
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, getLang(), { sensitivity: "base" }));
}

/** "Province", "State", "Region"...: what the country's regions are called (from the settings). */
export function regionLabel(settings: any, country?: string | null): string {
  const kind = (country && settings?.region_kinds?.[country]) || "province";
  return kind === "province" ? t("ui_province") : t(`ui_region_${kind}`);
}

// The look an administrator gave each interest (icon, colour, category), by slug; empty fields stay automatic.
type Look = { icon?: string | null; color?: string | null; category?: string | null };
const LOOKS: Record<string, Look> = {};

export function setInterestLooks(list: ({ slug: string } & Look)[]) {
  for (const i of list) LOOKS[i.slug] = { icon: i.icon, color: i.color, category: i.category };
}

export function interestLook(slug?: string | null): Look {
  return (slug && LOOKS[slug]) || {};
}

/** A community's colours: the one its interest was given, or the usual ones made from `seed`. */
export function communityCover(slug: string | null | undefined, seed: string | number, angle = 135): string {
  const color = interestLook(slug).color;
  return color ? `linear-gradient(${angle}deg, ${color}, color-mix(in srgb, ${color} 55%, #0b1220))` : coverGradient(seed, angle);
}

export function hobbyIcon(slug?: string | null, title?: string | null): string {
  return interestLook(slug).icon || guessIcon(slug, title);
}

/** The icon that fits the hobby's name, whatever was chosen in the administration. */
export function guessIcon(slug?: string | null, title?: string | null): string {
  const text = `${slug || ""} ${title || ""}`.toLowerCase();
  return HOBBY_ICONS.find(([re]) => re.test(text))?.[1] || "users";
}

