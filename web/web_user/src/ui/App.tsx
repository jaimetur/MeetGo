import React, { useCallback, useEffect, useState } from "react";
import { t } from "@lang";
import { API_BASE, api, getToken, setApiHandlers, setToken } from "../api";
import { native, setNativeHandlers } from "../native";
import { announceActiveConversation, registerServiceWorker, setupNativePush, subscribeExisting } from "../push";
import { startRealtime, stopRealtime, setRealtimeHooks } from "../realtime";
import { chatPath, dropQueryParams, navigate, queryParam, useRoute } from "../router";
import { getState, loadConversations, resetState, setState, toast, useStore } from "../store";
import { AuthScreen } from "./Auth";
import { ChatView } from "./Chat";
import { Icon } from "./common";
import { SidePanel } from "./Panels";
import { AccountPage, ExplorePage, JoinPage, MentionsPage, PeoplePage, SharePage } from "./Pages";
import { Paywall } from "./Paywall";
import { Sidebar } from "./Sidebar";

export function applyTheme(theme?: string) {
  let value = theme;
  if (!value) {
    try {
      value = localStorage.getItem("theme") || "system";
    } catch {
      value = "system";
    }
  }
  const dark = value === "dark" || (value === "system" && !window.matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
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
    setState({ billing: await api.billing() });
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

  useEffect(() => {
    applyTheme();
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
      if (getToken()) await startSession().catch(() => setToken(""));
      setBooting(false);
    })();
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  if (booting) return <div className="auth"><div className="logo"><span className="m">Meet</span><span className="g">Go</span></div></div>;
  if (!me) return <AuthScreen onSignedIn={startSession} />;
  return <Shell />;
}

export async function startSession() {
  const me = await api.me();
  setState({ me });
  native.setSession(API_BASE, getToken());
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

  const back = useCallback(() => {
    const r = route;
    if (r.name === "chat" && (r.thread || r.panel)) {
      navigate(chatPath(r.id));
      return true;
    }
    if (r.name !== "home" && window.matchMedia("(max-width: 820px)").matches) {
      navigate("/");
      return true;
    }
    return false;
  }, [route]);

  useEffect(() => {
    setNativeHandlers({ back });
    setRealtimeHooks({
      removed: (id) => getState().activeConversation === id && navigate("/"),
      requests: refreshRequests,
    });
  }, [back]);

  const panelOpen = route.name === "chat" && (!!route.thread || !!route.panel);
  const isPage = ["explore", "people", "mentions", "account", "share", "join"].includes(route.name);
  // "conv": inside a conversation the phone hides the bottom tab bar; the other screens keep it.
  const shellClass = ["shell", panelOpen ? "with-panel" : "", isPage ? "is-page" : "", route.name !== "home" ? "chat-open" : "", route.name === "chat" ? "conv" : ""].join(" ");
  const requestsTotal = requests.friends + requests.dms;

  const nav = [
    { name: "home", icon: "chat", label: t("ui_nav_chats"), badge: unread },
    { name: "explore", icon: "compass", label: t("ui_nav_channels"), badge: 0 },
    { name: "people", icon: "users", label: t("ui_nav_people"), badge: requestsTotal },
    { name: "mentions", icon: "at", label: t("ui_nav_mentions"), badge: mentions, at: true },
    { name: "account", icon: "user", label: t("ui_nav_account"), badge: 0 },
  ];
  const current = route.name === "chat" ? "home" : route.name;

  return (
    <div className={shellClass}>
      <nav className="rail" aria-label={t("ui_nav")}>
        <div className="mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 5 19 12 7 19z" fill="#fff" /></svg></div>
        {nav.map((n) => (
          <button key={n.name} className={"rb" + (current === n.name ? " on" : "")} title={n.label} aria-label={n.label} onClick={() => navigate(n.name === "home" ? "/" : "/" + n.name)}>
            <Icon name={n.icon} />
            {n.badge ? <span className={"bdg" + (n.at ? " at" : "")}>{n.badge > 99 ? "99+" : n.badge}</span> : null}
          </button>
        ))}
        <div className="grow" />
        <span className={"conn" + (connected ? " on" : "")} title={connected ? t("ui_connected") : t("ui_reconnecting")} />
      </nav>

      {!isPage ? <Sidebar activeId={activeId} /> : null}

      {route.name === "chat" ? <ChatView key={route.id} conversationId={route.id} around={route.around} /> : null}
      {route.name === "home" ? (
        <main className="chat">
          <div className="empty" style={{ margin: "auto" }}>
            <h3>{t("ui_pick_conversation")}</h3>
            <p>{t("ui_pick_conversation_hint")}</p>
          </div>
        </main>
      ) : null}
      {route.name === "explore" ? <ExplorePage /> : null}
      {route.name === "people" ? <PeoplePage /> : null}
      {route.name === "mentions" ? <MentionsPage /> : null}
      {route.name === "account" ? <AccountPage /> : null}
      {route.name === "share" ? <SharePage /> : null}
      {route.name === "join" ? <JoinPage code={route.code} /> : null}

      {route.name === "chat" && panelOpen ? <SidePanel conversationId={route.id} thread={route.thread} panel={route.panel} /> : null}

      <nav className="mnav" aria-label={t("ui_nav")}>
        {nav.map((n) => (
          <button key={n.name} className={current === n.name ? "on" : ""} onClick={() => navigate(n.name === "home" ? "/" : "/" + n.name)}>
            <Icon name={n.icon} />
            {n.label}
            {n.badge ? <span className={"bdg" + (n.at ? " at" : "")}>{n.badge > 99 ? "99+" : n.badge}</span> : null}
          </button>
        ))}
      </nav>

      {paywall ? <Paywall onClose={() => setState({ paywall: false })} /> : null}
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
