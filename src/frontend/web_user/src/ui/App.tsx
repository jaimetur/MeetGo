import React, { useCallback, useEffect, useState } from "react";
import type { Me } from "../types";
import { t } from "@lang";
import { API_BASE, api, getToken, setApiHandlers, setToken } from "../api";
import { native, setNativeHandlers } from "../native";
import { announceActiveConversation, registerServiceWorker, setupNativePush, subscribeExisting } from "../push";
import { startRealtime, stopRealtime, setRealtimeHooks } from "../realtime";
import { chatPath, dropQueryParams, goBack, navigate, queryParam, useRoute } from "../router";
import { getState, loadBlocks, loadConversations, loadAdminPending, loadCategories, loadMyCommunities, loadMyPlans, resetState, setState, toast, useStore } from "../store";
import { AuthScreen, CompleteProfile } from "./Auth";
import { ChatView } from "./Chat";
import { UpdateNotice } from "./UpdateNotice";
import { FeedPostPage, WallPage } from "./Feed";
import { useNoAutofill } from "../noAutofill";
import { HomePage, PostPage, PublishPage } from "./Board";
import { AboutModal, Avatar, Icon, InstallHint, applyLayout, Splash, Wordmark, setInterestLooks } from "./common";
import { CommunitiesPage, CommunityPage } from "./Communities";
import { SidePanel } from "./Panels";
import { AccountPage, JoinPage, MentionsPage, PeoplePage, SharePage, accountMemory } from "./Pages";
import { PlansPage, RightColumn } from "./Plans";
import { ActingAsBar, AdminPage } from "./Admin";
import { ZoneTag } from "./Board";
import { Paywall } from "./Paywall";
import { NewChatModal, Sidebar } from "./Sidebar";

/** Colour themes: thirteen light and eleven dark (the colours are in styles.css, :root[data-palette=…]); `bg`, `panel` and
 *  `accent` are only for the swatches in Settings. "system" follows the device: Light or Night. */
export const THEMES: Record<string, { dark: boolean; label: string; bg: string; panel: string; accent: string; accent2: string }> = {
  pastel: { dark: false, label: "ui_theme_pastel", bg: "#f6f7f9", panel: "#ffffff", accent: "#1d6fe0", accent2: "#f0a6c8" },
  conversa: { dark: false, label: "ui_theme_conversa", bg: "#efeae2", panel: "#0b5c50", accent: "#128c7e", accent2: "#25d366" },
  momentos: { dark: false, label: "ui_theme_momentos", bg: "#fff8fb", panel: "#ffffff", accent: "#fa7e1e", accent2: "#962fbf" },
  meetgo: { dark: false, label: "ui_theme_pastel", bg: "#eaf2fd", panel: "#ffffff", accent: "#1b74e4", accent2: "#1b74e4" },
  muro: { dark: false, label: "ui_theme_muro", bg: "#e9ebf0", panel: "#1c2b4b", accent: "#4267b2", accent2: "#4267b2" },
  chispa: { dark: false, label: "ui_theme_chispa", bg: "#fff4f5", panel: "#ffffff", accent: "#fd267a", accent2: "#ff7854" },
  quedadas: { dark: false, label: "ui_theme_quedadas", bg: "#fdf0e4", panel: "#8a2e26", accent: "#d9363e", accent2: "#f08a5d" },
  light: { dark: false, label: "ui_theme_light", bg: "#f4f6fa", panel: "#ffffff", accent: "#1670e0", accent2: "#0a96cc" },
  sand: { dark: false, label: "ui_theme_sand", bg: "#f6f0e6", panel: "#fffdf8", accent: "#b8651c", accent2: "#d98b2b" },
  mint: { dark: false, label: "ui_theme_mint", bg: "#ecf7f2", panel: "#ffffff", accent: "#0e9f7a", accent2: "#12b5a0" },
  lavender: { dark: false, label: "ui_theme_lavender", bg: "#f3f1fb", panel: "#ffffff", accent: "#6d4ae0", accent2: "#9b6cf0" },
  peach: { dark: false, label: "ui_theme_peach", bg: "#fcf1ec", panel: "#ffffff", accent: "#e0563b", accent2: "#f08a5d" },
  sky: { dark: false, label: "ui_theme_sky", bg: "#e9f4fd", panel: "#ffffff", accent: "#1286d6", accent2: "#22a6e6" },
  pro: { dark: false, label: "ui_theme_pro", bg: "#f6f7f9", panel: "#ffffff", accent: "#1d6fe0", accent2: "#1d6fe0" },
  pasteldark: { dark: true, label: "ui_theme_pasteldark", bg: "#0b0f17", panel: "#121826", accent: "#4c8dff", accent2: "#c4a5f5" },
  conversadark: { dark: true, label: "ui_theme_conversadark", bg: "#0b141a", panel: "#202c33", accent: "#00a884", accent2: "#25d366" },
  momentosdark: { dark: true, label: "ui_theme_momentosdark", bg: "#000000", panel: "#0a0a0a", accent: "#fb923c", accent2: "#a855f7" },
  meetgodark: { dark: true, label: "ui_theme_pasteldark", bg: "#18191a", panel: "#242526", accent: "#2d88ff", accent2: "#2d88ff" },
  murodark: { dark: true, label: "ui_theme_murodark", bg: "#121826", panel: "#0b1120", accent: "#6d8fd6", accent2: "#6d8fd6" },
  chispadark: { dark: true, label: "ui_theme_chispadark", bg: "#111418", panel: "#1b1f24", accent: "#fd267a", accent2: "#ff7854" },
  quedadasdark: { dark: true, label: "ui_theme_quedadasdark", bg: "#17120f", panel: "#3a1713", accent: "#ff6b6b", accent2: "#f08a5d" },
  dark: { dark: true, label: "ui_theme_dark", bg: "#0b1220", panel: "#0f192b", accent: "#1e90ff", accent2: "#00c2ff" },
  oled: { dark: true, label: "ui_theme_oled", bg: "#000000", panel: "#0b0b0b", accent: "#1e90ff", accent2: "#00c2ff" },
  forest: { dark: true, label: "ui_theme_forest", bg: "#0b1712", panel: "#0f1f18", accent: "#2fbf71", accent2: "#3dd6a3" },
  prodark: { dark: true, label: "ui_theme_prodark", bg: "#0b0f17", panel: "#121826", accent: "#4c8dff", accent2: "#4c8dff" },
  plum: { dark: true, label: "ui_theme_plum", bg: "#150e1e", panel: "#1d1429", accent: "#a66cff", accent2: "#e070d8" },
  mosaico: { dark: false, label: "ui_theme_mosaico", bg: "#edf4f2", panel: "#ffffff", accent: "#0f8a7e", accent2: "#12b5a3" },
  mosaicodark: { dark: true, label: "ui_theme_mosaicodark", bg: "#0d1412", panel: "#151d1b", accent: "#2cc4b3", accent2: "#2cc4b3" },
  sanddark: { dark: true, label: "ui_theme_sand", bg: "#17120c", panel: "#201911", accent: "#d9893a", accent2: "#e6a456" },
  peachdark: { dark: true, label: "ui_theme_peach", bg: "#1a0f0c", panel: "#24140f", accent: "#f07152", accent2: "#f59a74" },
  paper: { dark: false, label: "ui_theme_bw", bg: "#ffffff", panel: "#ffffff", accent: "#1670e0", accent2: "#0a96cc" },
};

/** Size of the chat's text (this device): small (the earlier size), normal or large. */
export const CHAT_SIZES = ["small", "normal", "large"] as const;
export function applyChatSize(size?: string) {
  let value = size;
  if (!value) {
    try {
      value = localStorage.getItem("chatSize") || "normal";
    } catch {
      value = "normal";
    }
  }
  document.documentElement.dataset.chatsize = (CHAT_SIZES as readonly string[]).includes(value) ? value : "normal";
}

/** Each theme in its two versions, day and night: Settings shows one swatch per theme and a Day / Night / Auto switch.
 *  The first seven go with the seven designs (Settings → Design). */
export const THEME_FAMILIES: Record<string, { label: string; light: string; dark: string }> = {
  meetgo: { label: "ui_theme_pastel", light: "meetgo", dark: "meetgodark" },  // the colours of Muro, on a light blue ground by day
  conversa: { label: "ui_theme_conversa", light: "conversa", dark: "conversadark" },
  momentos: { label: "ui_theme_momentos", light: "momentos", dark: "momentosdark" },
  muro: { label: "ui_theme_muro", light: "muro", dark: "murodark" },
  chispa: { label: "ui_theme_chispa", light: "chispa", dark: "chispadark" },
  quedadas: { label: "ui_theme_quedadas", light: "quedadas", dark: "quedadasdark" },
  mosaico: { label: "ui_theme_mosaico", light: "mosaico", dark: "mosaicodark" },
  classic: { label: "ui_theme_classic", light: "light", dark: "dark" },
  sober: { label: "ui_theme_pro", light: "pro", dark: "prodark" },
  mint: { label: "ui_theme_mint", light: "mint", dark: "forest" },
  lavender: { label: "ui_theme_lavender", light: "lavender", dark: "plum" },
  sand: { label: "ui_theme_sand", light: "sand", dark: "sanddark" },
  peach: { label: "ui_theme_peach", light: "peach", dark: "peachdark" },
  bw: { label: "ui_theme_bw", light: "paper", dark: "oled" },
};
export const DESIGN_FAMILIES = ["meetgo", "muro", "mosaico", "conversa", "chispa", "quedadas", "momentos"];  // in pairs of similar colours
export type ThemeMode = "light" | "dark" | "auto";
export type ThemeChoice = { family: string; mode: ThemeMode };

/** Once on every device: the MeetGo design, the MeetGo theme and Auto (day or night as the device); the person can change
 *  them afterwards. */
const STYLE_VERSION = "3";
export function resetStyleOnce() {
  try {
    if (localStorage.getItem("styleVersion") === STYLE_VERSION) return;
    localStorage.setItem("themeFamily", "meetgo");
    localStorage.setItem("themeMode", "auto");
    localStorage.setItem("communityLayout", "actual");
    localStorage.setItem("styleVersion", STYLE_VERSION);
  } catch {
    /* per-device preference */
  }
}

/** The theme chosen on this device; one saved the earlier way (a single theme) becomes its family and mode. */
export function readThemeChoice(): ThemeChoice {
  try {
    const family = localStorage.getItem("themeFamily");
    const mode = localStorage.getItem("themeMode") as ThemeMode;
    if (family && THEME_FAMILIES[family]) return { family, mode: mode === "light" || mode === "dark" ? mode : "auto" };
    // Cielo is no longer offered: it becomes Classic by day
    const old = localStorage.getItem("theme") === "sky" ? "light" : localStorage.getItem("theme");
    for (const [key, f] of Object.entries(THEME_FAMILIES)) {
      if (old === f.light) return { family: key, mode: "light" };
      if (old === f.dark) return { family: key, mode: "dark" };
    }
  } catch {
    /* per-device preference */
  }
  return { family: "meetgo", mode: "auto" };
}

export function saveThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem("themeFamily", choice.family);
    localStorage.setItem("themeMode", choice.mode);
  } catch {
    /* per-device preference */
  }
  applyTheme(choice);
}

export function applyTheme(choice: ThemeChoice = readThemeChoice()) {
  const family = THEME_FAMILIES[choice.family] || THEME_FAMILIES.classic;
  const night = choice.mode === "auto" ? !window.matchMedia("(prefers-color-scheme: light)").matches : choice.mode === "dark";
  const value = night ? family.dark : family.light;
  const root = document.documentElement;
  root.dataset.theme = THEMES[value].dark ? "dark" : "light";
  root.dataset.palette = value;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES[value].bg);
}

export async function refreshRequests() {
  try {
    const [friends, dms, communities] = await Promise.all([api.friendRequests(), api.dmRequests(), api.communityInvites().catch(() => [])]);
    setState({ requests: { friends: friends.length, dms: dms.length, communities: communities.length } });
  } catch {
    /* not critical */
  }
}

export async function refreshBilling() {
  try {
    const [billing, settings] = await Promise.all([api.billing(), api.publicSettings()]);
    setState({ billing, subscriptions: !!settings?.subscriptions });
  } catch {
    /* not critical */
  }
}

export function signOut() {
  api.logout().catch(() => undefined);
  stopRealtime();
  setToken("");
  native.setSession(API_BASE, "");
  resetState();
  navigate("/", true);
}

/** The chat I had open (kept on this device, also when the app or the server restarts): Chats opens on it again;
 *  going back to the list forgets it. */
const chatMemory = {
  get id(): number | null {
    try {
      return Number(localStorage.getItem("lastChat")) || null;
    } catch {
      return null;
    }
  },
  set id(v: number | null) {
    try {
      if (v) localStorage.setItem("lastChat", String(v));
      else localStorage.removeItem("lastChat");
    } catch {
      /* per-device preference */
    }
  },
};

/** My name in the menu: first name and first surname, or the surname's initial when it does not fit. */
function MyName({ me }: { me: Me }) {
  const first = (me.first_name || "").trim();
  const surname = (me.last_name || "").trim().split(/\s+/)[0] || "";
  const full = first ? [first, surname].filter(Boolean).join(" ") : me.display_name;
  const short = first && surname ? `${first} ${surname[0]}.` : full;
  const ref = React.useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      el.textContent = full;
      const ok = el.scrollWidth <= el.clientWidth;
      el.textContent = ok ? full : short;
      setFits(ok);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full, short]);
  return <span ref={ref} className="dl myname">{fits ? full : short}</span>;
}

export default function App() {
  useNoAutofill();
  const me = useStore((s) => s.me);
  const [booting, setBooting] = useState(true);
  // The opening screen stays at least a moment the first time the app opens in this tab.
  const [splash, setSplash] = useState<"on" | "leaving" | "off">(() => {
    try { return sessionStorage.getItem("splashSeen") ? "off" : "on"; } catch { return "on"; }
  });

  useEffect(() => {
    resetStyleOnce();
    applyTheme();
    applyLayout();
    applyChatSize();
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme();  // Auto follows the device
    mq.addEventListener?.("change", onChange);
    setApiHandlers({ unauthorized: signOut, paymentRequired: () => setState({ paywall: true }) });
    (async () => {
      const verify = queryParam("verify_token");
      if (verify) {
        try {
          await api.verifyEmail(verify);
          toast(t("ui_email_verified"));
        } catch (e: any) {
          toast(e.message, "error");
        }
        dropQueryParams("verify_token");
      }
      const started = Date.now();
      // The saved session is dropped only when the server says it is no longer valid; while it cannot answer (it is
      // restarting, no network) the app keeps trying, and stays signed in.
      for (let wait = 1000; getToken(); wait = Math.min(wait * 2, 5000)) {
        try { await startSession(); break; } catch (e: any) {
          if (e?.status === 401 || e?.status === 403) { setToken(""); break; }
          await new Promise((r) => window.setTimeout(r, wait));
        }
      }
      setBooting(false);
      window.setTimeout(() => setSplash((s) => (s === "on" ? "leaving" : s)), Math.max(0, 1400 - (Date.now() - started)));
      window.setTimeout(() => {
        setSplash("off");
        try { sessionStorage.setItem("splashSeen", "1"); } catch { /* private mode */ }
      }, Math.max(0, 1400 - (Date.now() - started)) + 450);
    })();
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  if (booting) return <Splash />;
  return (
    <>
      {me ? <Shell /> : <AuthScreen onSignedIn={startSession} />}
      <UpdateNotice />
      {splash !== "off" ? <Splash leaving={splash === "leaving"} /> : null}
    </>
  );
}

/** A finger on something that scrolls sideways (suggested communities, tab strips…) scrolls it: it is not a swipe
 *  to the next section. */
function insideSideScroller(el: HTMLElement | null): boolean {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.scrollWidth > e.clientWidth + 2) {
      const o = getComputedStyle(e).overflowX;
      if (o === "auto" || o === "scroll") return true;
    }
  }
  return false;
}

export async function startSession() {
  const me = await api.me();
  setState({ me });
  native.setSession(API_BASE, getToken());
  // a fresh token each time the app opens: this device stays signed in while it is used
  api.refresh().then((r) => { if (r?.access_token && getToken()) { setToken(r.access_token); native.setSession(API_BASE, r.access_token); } }).catch(() => undefined);
  // the look given to each interest in the administration (icons, colours, categories)
  await api.interests().then(setInterestLooks).catch(() => undefined);
  await loadConversations();
  refreshBilling();
  refreshRequests();
  startRealtime();
  setupNativePush();
  registerServiceWorker().then(() => subscribeExisting().catch(() => undefined));
  const sessionId = queryParam("session_id");
  if (queryParam("billing") === "success" && sessionId) {
    try {
      setState({ billing: await api.complete(sessionId) });
      toast(t("ui_plan_active"));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  dropQueryParams("billing", "session_id", "view", "code");
}

function Shell() {
  const route = useRoute();
  const conversations = useStore((s) => s.conversations);
  const requests = useStore((s) => s.requests);
  const me = useStore((s) => s.me);
  const connected = useStore((s) => s.connected);
  const paywall = useStore((s) => s.paywall);
  const unread = Object.values(conversations).reduce((n, c) => n + (c.notify === "none" || (c.muted_until && new Date(c.muted_until) > new Date()) ? 0 : c.unread_count), 0);
  const mentions = Object.values(conversations).reduce((n, c) => n + c.mention_count, 0);
  const activeId = route.name === "chat" ? route.id : null;

  useEffect(() => {
    setState({ activeConversation: activeId });
    announceActiveConversation(activeId);
  }, [activeId]);

  useEffect(() => {
    document.title = unread ? `(${unread}) MeetGo` : "MeetGo";
    native.setBadge(unread);
  }, [unread]);

  // My plans and communities feed the right column, the Chats filters and Publish; joining or leaving a
  // community changes my chat rooms, so the list follows them.
  const roomCount = Object.values(conversations).filter((c) => c.kind === "channel").length;
  useEffect(() => {
    loadMyPlans();
    loadCategories();
    loadAdminPending();
  }, []);
  const adminPending = useStore((s) => s.adminPending?.total || 0);
  useEffect(() => {
    loadMyCommunities();
    loadBlocks();
  }, [roomCount]);

  const back = useCallback(() => {
    const r = route;
    if (r.name === "chat" && (r.thread || r.panel)) {
      navigate(chatPath(r.id));
      return true;
    }
    if (r.name === "chat") {
      navigate("/chats");
      return true;
    }
    if (r.name !== "home" && window.matchMedia("(max-width: 820px)").matches) {
      goBack("/");
      return true;
    }
    return false;
  }, [route]);

  useEffect(() => {
    setNativeHandlers({ back });
    setRealtimeHooks({
      removed: (id) => getState().activeConversation === id && navigate("/chats"),
      requests: refreshRequests,
    });
  }, [back]);

  const chatsMode = route.name === "chats" || route.name === "chat";
  const panelOpen = route.name === "chat" && (!!route.thread || !!route.panel);
  // Detail screens (a post, publishing) hide the phone tab bar, like a conversation.
  const detail = route.name === "post" || route.name === "publish" || route.name === "feedpost" || route.name === "wall";
  const withRight = ["home", "plans", "communities", "post"].includes(route.name) || (route.name === "community" && route.tab !== "chat");
  const shellClass = [
    "shell", chatsMode ? "chats" : "pages", panelOpen ? "with-panel" : "", withRight ? "has-right" : "",
    route.name === "chat" ? "chat-open conv" : "", detail ? "conv detail" : "",
  ].join(" ");
  const requestsTotal = requests.friends + requests.dms + (requests.communities || 0);

  // Which tab is lit for the current screen.
  const current = ({ chat: "chats", post: "home", feedpost: "home", wall: "home", community: "communities", join: "communities", share: "chats" } as Record<string, string>)[route.name] || route.name;
  useEffect(() => {
    if (route.name === "chat") chatMemory.id = route.id;
    else if (route.name === "chats") chatMemory.id = null;
  }, [route]);
  // my account opens on the tab I was on in this session, and Chats on the chat I had open
  const go = (name: string) => {
    const last = chatMemory.id;
    if (name === "chats" && last && getState().conversations[last]) return navigate(chatPath(last));
    navigate(name === "home" ? "/" : name === "account" && accountMemory.section !== "profile" ? `/account?section=${accountMemory.section}` : "/" + name);
  };

  const menu = [
    { name: "home", icon: "home", label: t("ui_nav_home"), badge: 0 },
    { name: "communities", icon: "compass", label: t("ui_nav_communities"), badge: 0 },
    { name: "chats", icon: "chat", label: t("ui_nav_chats"), badge: unread },
    { name: "plans", icon: "calendar", label: t("ui_nav_plans"), badge: 0 },
    { name: "people", icon: "users", label: t("ui_nav_people"), badge: requestsTotal },
    { name: "mentions", icon: "at", label: t("ui_nav_mentions"), badge: mentions, at: true },
    { name: "account", icon: "user", label: t("ui_nav_profile"), badge: 0 },
    ...(me?.role === "admin" ? [{ name: "admin", icon: "shield", label: t("ui_nav_admin"), badge: adminPending }] : []),
  ];
  // Phones: Home · Communities · Chats · Plans · People; the profile is in the avatar's menu at the top, and a round ＋ to publish at the side. Swiping moves
  // between the tabs.
  const tabs = [
    { name: "home", icon: "home", label: t("ui_nav_home"), badge: 0 },
    { name: "communities", icon: "compass", label: t("ui_nav_communities"), badge: 0 },
    { name: "chats", icon: "chat", label: t("ui_nav_chats"), badge: unread },
    { name: "plans", icon: "calendar", label: t("ui_nav_plans"), badge: 0 },
    { name: "people", icon: "users", label: t("ui_nav_people"), badge: requestsTotal },
  ];
  const swipeOrder = ["home", "communities", "chats", "plans", "people"];
  const showFab = ["home", "plans", "communities"].includes(route.name) || (route.name === "community" && route.tab !== "chat");
  const publish = () => navigate(route.name === "community" ? `/publish?community=${route.id}` : "/publish");
  const [newChat, setNewChat] = useState(false);
  const [about, setAbout] = useState(false);

  const swipe = React.useRef<{ x: number; y: number; t: number } | null>(null);
  const tabIndex = swipeOrder.indexOf(route.name);
  const onTouchStart = (e: React.TouchEvent) => {
    const el = e.target as HTMLElement;
    swipe.current = tabIndex < 0 || e.touches.length > 1 || el.closest(".chips, .segtabs, input, textarea, select, .modal-bg, .sheet-bg")
      || insideSideScroller(el) ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || !window.matchMedia("(max-width: 820px)").matches) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - start.t > 700) return;
    const next = swipeOrder[tabIndex + (dx < 0 ? 1 : -1)];
    if (next) go(next);
  };

  return (
    <div className={shellClass} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <nav className="dnav" aria-label={t("ui_nav")}>
        {/* the logo opens About MeetGo */}
        <button className="dlogo" onClick={() => setAbout(true)} aria-label={t("ui_about_title")}>
          <img className="appicon" src="/apple-touch-icon.png" alt="" />
          <Wordmark size={24} />
        </button>
        <div className="dzone"><ZoneTag /></div>
        {menu.map((n) => (
          <button key={n.name} className={"di" + (current === n.name ? " on" : "")} title={n.label} aria-label={n.label} aria-current={current === n.name ? "page" : undefined} onClick={() => go(n.name)}>
            {n.name === "account" && me ? <Avatar user={me} size={24} /> : <Icon name={n.icon} />}
            {n.name === "account" && me ? <MyName me={me} /> : <span className="dl">{n.label}</span>}
            {n.badge ? <span className={"bdg" + (n.at ? " at" : "")}>{n.badge > 99 ? "99+" : n.badge}</span> : null}
          </button>
        ))}
        <button className="btn go dpub" onClick={() => go("publish")} title={t("ui_nav_publish")} aria-label={t("ui_nav_publish")}>
          <Icon name="plus" /><span className="dl">{t("ui_nav_publish")}</span>
        </button>
        <div className="grow" />
        {/* the connection to the server, and the app's version (opens About MeetGo) */}
        <div className="dnav-foot">
          <span className={"conn" + (connected ? " on" : "")} title={connected ? t("ui_connected") : t("ui_reconnecting")} />
          <button type="button" className="appver" onClick={() => setAbout(true)} title={t("ui_about_title")}>v{__APP_VERSION__}</button>
        </div>
      </nav>

      {chatsMode ? <Sidebar activeId={activeId} /> : null}
      {about ? <AboutModal onClose={() => setAbout(false)} /> : null}

      {route.name === "chat" ? <ChatView key={route.id} conversationId={route.id} around={route.around} /> : null}
      {route.name === "chats" ? (
        <main className="chat">
          <div className="empty" style={{ margin: "auto" }}>
            <h3>{t("ui_pick_conversation")}</h3>
            <p>{t("ui_pick_conversation_hint")}</p>
          </div>
        </main>
      ) : null}
      {route.name === "home" ? <HomePage /> : null}
      {route.name === "plans" ? <PlansPage /> : null}
      {route.name === "publish" ? <PublishPage key={`${route.community}:${route.repeat}:${route.edit}`} community={route.community} repeat={route.repeat} edit={route.edit} /> : null}
      {route.name === "post" ? <PostPage key={route.id} id={route.id} /> : null}
      {route.name === "feedpost" ? <FeedPostPage key={route.id} id={route.id} /> : null}
      {route.name === "wall" ? <WallPage key={route.id} id={route.id} /> : null}
      {route.name === "communities" ? <CommunitiesPage /> : null}
      {route.name === "community" ? <CommunityPage key={route.id} id={route.id} tab={route.tab} /> : null}
      {route.name === "people" ? <PeoplePage /> : null}
      {route.name === "mentions" ? <MentionsPage /> : null}
      {route.name === "account" ? <AccountPage /> : null}
      {route.name === "share" ? <SharePage /> : null}
      {route.name === "join" ? <JoinPage code={route.code} /> : null}
      {route.name === "admin" ? <AdminPage /> : null}

      {withRight ? <RightColumn /> : null}
      {route.name === "chat" && panelOpen ? <SidePanel conversationId={route.id} thread={route.thread} panel={route.panel} /> : null}

      <nav className="mnav" aria-label={t("ui_nav")}>
        {tabs.map((n) => (
          <button key={n.name} className={`t-${n.name}` + (current === n.name ? " on" : "")} aria-current={current === n.name ? "page" : undefined} onClick={() => go(n.name)}>
            <Icon name={n.icon} />
            <span className="ml">{n.label}</span>
            {n.badge ? <span className="bdg">{n.badge > 99 ? "99+" : n.badge}</span> : null}
          </button>
        ))}
      </nav>
      {route.name === "chats" ? <button className="mfab chatfab" aria-label={t("ui_new_chat")} title={t("ui_new_chat")} onClick={() => setNewChat(true)}><Icon name="edit" /></button> : null}
      {newChat ? <NewChatModal onClose={() => setNewChat(false)} /> : null}
      {showFab ? <button className="mfab" aria-label={t("ui_nav_publish")} title={t("ui_nav_publish")} onClick={publish}><Icon name="plus" /></button> : null}

      {route.name !== "chat" && !detail ? <InstallHint /> : null}
      {paywall ? <Paywall onClose={() => setState({ paywall: false })} /> : null}
      {me && !me.bot_role && (!me.first_name || !me.last_name) ? <CompleteProfile me={me} onSaved={(u) => setState({ me: u })} /> : null}
      <ActingAsBar />
      <Toasts />
      <AdminNotice />
    </div>
  );
}

/** Administrators: a notice while something waits for review (reports, proposed categories, communities to split or
 * join), when they open MeetGo or something new arrives. Closing it hides it until something new arrives; once
 * reviewed (by anyone) it goes away for everybody. */
function AdminNotice() {
  const waiting = useStore((s) => s.adminPending);
  const pending = waiting?.total || 0;
  // the tab with something to review (the first one, in the order of the tabs)
  const where = (["communities", "categories", "moderation"] as const).find((k) => (waiting?.[k] || 0) > 0);
  const route = useRoute();
  const [closedAt, setClosedAt] = useState(0);
  const showing = !!pending && pending > closedAt && route.name !== "admin";
  // stacked above the update notice when both show (they share the bottom of the screen)
  const [bottom, setBottom] = useState<number | null>(null);
  useEffect(() => {
    if (!showing) return;
    const place = () => {
      const other = document.querySelector<HTMLElement>(".updnote");
      const r = other?.getBoundingClientRect();
      setBottom(r && r.height ? Math.round(window.innerHeight - r.top + 10) : null);
    };
    place();
    const timer = window.setInterval(place, 700);
    window.addEventListener("resize", place);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", place); };
  }, [showing]);
  if (!showing) return null;
  return (
    <div className="admin-notice" role="alert" style={bottom != null ? { bottom } : undefined}>
      <Icon name="shield" />
      <span className="grow">{t("ui_admin_pending", { n: pending })}</span>
      <button className="btn pri sm" onClick={() => { setClosedAt(pending); navigate(where ? `/admin?s=${where}${where === "communities" ? "&f=suggested" : ""}` : "/admin"); }}>{t("ui_admin_review")}</button>
      <button className="iconbtn" aria-label={t("ui_close")} onClick={() => setClosedAt(pending)}><Icon name="x" size="sm" /></button>
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  // stacked above the notices at the bottom (update, administration), never on top of them
  const [bottom, setBottom] = useState<number | null>(null);
  useEffect(() => {
    if (!toasts.length) return;
    const place = () => {
      const tops = Array.from(document.querySelectorAll<HTMLElement>(".updnote, .admin-notice")).map((el) => el.getBoundingClientRect()).filter((r) => r.height).map((r) => r.top);
      setBottom(tops.length ? Math.round(window.innerHeight - Math.min(...tops) + 10) : null);
    };
    place();
    const timer = window.setInterval(place, 500);
    return () => window.clearInterval(timer);
  }, [toasts.length]);
  return (
    <div className="toasts" role="status" aria-live="polite" style={bottom != null ? { bottom } : undefined}>
      {toasts.map((x) => <div key={x.id} className={"toast " + x.kind}>{x.text}</div>)}
    </div>
  );
}
