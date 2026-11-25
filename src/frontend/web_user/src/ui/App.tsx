import React, { useCallback, useEffect, useState } from "react";
import { t } from "@lang";
import { API_BASE, api, getToken, setApiHandlers, setToken } from "../api";
import { native, setNativeHandlers } from "../native";
import { announceActiveConversation, registerServiceWorker, setupNativePush, subscribeExisting } from "../push";
import { startRealtime, stopRealtime, setRealtimeHooks } from "../realtime";
import { chatPath, dropQueryParams, goBack, navigate, queryParam, useRoute } from "../router";
import { getState, loadBlocks, loadConversations, loadMyCommunities, loadMyPlans, resetState, setState, toast, useStore } from "../store";
import { AuthScreen } from "./Auth";
import { ChatView } from "./Chat";
import { HomePage, PostPage, PublishPage } from "./Board";
import { AboutModal, Icon, InstallHint, Splash, Wordmark, setInterestLooks } from "./common";
import { CommunitiesPage, CommunityPage } from "./Communities";
import { SidePanel } from "./Panels";
import { AccountPage, JoinPage, MentionsPage, PeoplePage, SharePage } from "./Pages";
import { PlansPage, RightColumn } from "./Plans";
import { ActingAsBar, AdminPage } from "./Admin";
import { ZoneTag } from "./Board";
import { Paywall } from "./Paywall";
import { NewChatModal, Sidebar } from "./Sidebar";

/** Colour themes: six light and four dark (the colours are in styles.css, :root[data-palette=…]); `bg`, `panel` and
 *  `accent` are only for the swatches in Settings. "system" follows the device: Light or Night. */
export const THEMES: Record<string, { dark: boolean; label: string; bg: string; panel: string; accent: string; accent2: string }> = {
  light: { dark: false, label: "ui_theme_light", bg: "#f4f6fa", panel: "#ffffff", accent: "#1670e0", accent2: "#0a96cc" },
  sand: { dark: false, label: "ui_theme_sand", bg: "#f6f0e6", panel: "#fffdf8", accent: "#b8651c", accent2: "#d98b2b" },
  mint: { dark: false, label: "ui_theme_mint", bg: "#ecf7f2", panel: "#ffffff", accent: "#0e9f7a", accent2: "#12b5a0" },
  lavender: { dark: false, label: "ui_theme_lavender", bg: "#f3f1fb", panel: "#ffffff", accent: "#6d4ae0", accent2: "#9b6cf0" },
  peach: { dark: false, label: "ui_theme_peach", bg: "#fcf1ec", panel: "#ffffff", accent: "#e0563b", accent2: "#f08a5d" },
  sky: { dark: false, label: "ui_theme_sky", bg: "#e9f4fd", panel: "#ffffff", accent: "#1286d6", accent2: "#22a6e6" },
  dark: { dark: true, label: "ui_theme_dark", bg: "#0b1220", panel: "#0f192b", accent: "#1e90ff", accent2: "#00c2ff" },
  oled: { dark: true, label: "ui_theme_oled", bg: "#000000", panel: "#0b0b0b", accent: "#1e90ff", accent2: "#00c2ff" },
  forest: { dark: true, label: "ui_theme_forest", bg: "#0b1712", panel: "#0f1f18", accent: "#2fbf71", accent2: "#3dd6a3" },
  plum: { dark: true, label: "ui_theme_plum", bg: "#150e1e", panel: "#1d1429", accent: "#a66cff", accent2: "#e070d8" },
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

export function applyTheme(theme?: string) {
  let value = theme;
  if (!value) {
    try {
      value = localStorage.getItem("theme") || "system";
    } catch {
      value = "system";
    }
  }
  if (value === "system" || !THEMES[value]) value = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const root = document.documentElement;
  root.dataset.theme = THEMES[value].dark ? "dark" : "light";
  root.dataset.palette = value;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES[value].bg);
}

export async function refreshRequests() {
  try {
    const [friends, dms] = await Promise.all([api.friendRequests(), api.dmRequests()]);
    setState({ requests: { friends: friends.length, dms: dms.length } });
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

export default function App() {
  const me = useStore((s) => s.me);
  const [booting, setBooting] = useState(true);
  // The opening screen stays at least a moment the first time the app opens in this tab.
  const [splash, setSplash] = useState<"on" | "leaving" | "off">(() => {
    try { return sessionStorage.getItem("splashSeen") ? "off" : "on"; } catch { return "on"; }
  });

  useEffect(() => {
    applyTheme();
    applyChatSize();
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme();
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
      if (getToken()) await startSession().catch(() => setToken(""));
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
  }, []);
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
  const detail = route.name === "post" || route.name === "publish";
  const withRight = ["home", "plans", "communities", "post"].includes(route.name) || (route.name === "community" && route.tab !== "chat");
  const shellClass = [
    "shell", chatsMode ? "chats" : "pages", panelOpen ? "with-panel" : "", withRight ? "has-right" : "",
    route.name === "chat" ? "chat-open conv" : "", detail ? "conv detail" : "",
  ].join(" ");
  const requestsTotal = requests.friends + requests.dms;

  // Which tab is lit for the current screen.
  const current = ({ chat: "chats", post: "home", community: "communities", join: "communities", share: "chats" } as Record<string, string>)[route.name] || route.name;
  const go = (name: string) => navigate(name === "home" ? "/" : "/" + name);

  const menu = [
    { name: "home", icon: "home", label: t("ui_nav_home"), badge: 0 },
    { name: "communities", icon: "compass", label: t("ui_nav_communities"), badge: 0 },
    { name: "chats", icon: "chat", label: t("ui_nav_chats"), badge: unread },
    { name: "plans", icon: "calendar", label: t("ui_nav_plans"), badge: 0 },
    { name: "people", icon: "users", label: t("ui_nav_people"), badge: requestsTotal },
    { name: "mentions", icon: "at", label: t("ui_nav_mentions"), badge: mentions, at: true },
    { name: "account", icon: "user", label: t("ui_nav_profile"), badge: 0 },
    ...(me?.role === "admin" ? [{ name: "admin", icon: "shield", label: t("ui_nav_admin"), badge: 0 }] : []),
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
        {/* a right click on the logo opens About MeetGo */}
        <button className="dlogo" onClick={() => go("home")} onContextMenu={(e) => { e.preventDefault(); setAbout(true); }} aria-label="MeetGo">
          <img className="appicon" src="/apple-touch-icon.png" alt="" />
          <Wordmark size={24} />
        </button>
        <div className="dzone"><ZoneTag /></div>
        {menu.map((n) => (
          <button key={n.name} className={"di" + (current === n.name ? " on" : "")} title={n.label} aria-label={n.label} aria-current={current === n.name ? "page" : undefined} onClick={() => go(n.name)}>
            <Icon name={n.icon} />
            <span className="dl">{n.label}</span>
            {n.badge ? <span className={"bdg" + (n.at ? " at" : "")}>{n.badge > 99 ? "99+" : n.badge}</span> : null}
          </button>
        ))}
        <button className="btn go dpub" onClick={() => go("publish")} title={t("ui_nav_publish")} aria-label={t("ui_nav_publish")}>
          <Icon name="plus" /><span className="dl">{t("ui_nav_publish")}</span>
        </button>
        <div className="grow" />
        <span className={"conn" + (connected ? " on" : "")} title={connected ? t("ui_connected") : t("ui_reconnecting")} />
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
      <ActingAsBar />
      <Toasts />
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => <div key={x.id} className={"toast " + x.kind}>{x.text}</div>)}
    </div>
  );
}
