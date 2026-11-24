import React, { useEffect, useState } from "react";
import { LANGUAGES, getLang, setLang, t } from "@lang";
import { api } from "../api";
import { isNativeApp, native } from "../native";
import { disableWebPush, enableWebPush, webPushPermission, webPushSubscribed, webPushSupported } from "../push";
import { chatPath, communityPath, navigate, queryParam, useRoute } from "../router";
import { loadBlocks, loadConversations, loadMyCommunities, setState, toast, useStore } from "../store";
import type { Interest, Message, UserSummary } from "../types";
import { dayLabel, timeOf } from "../util";
import { CHAT_SIZES, THEMES, applyChatSize, applyTheme, refreshBilling, refreshRequests, signOut } from "./App";
import { sendMessage } from "./Chat";
import { Avatar, Icon, convTitle, countryOptions, regionLabel } from "./common";
import { PlanPicker, describeBilling } from "./Paywall";
import { PhoneTop } from "./Board";

function PageShell({ title, lead, children, tab }: { title: string; lead?: string; children: React.ReactNode; tab?: boolean }) {
  // `tab`: a screen of the phone's tab bar (People): the usual top bar instead of a back button
  return (
    <main className="page">
      {tab ? <PhoneTop title={title} /> : null}
      <div className="wrapw">
        <div className={"row" + (tab ? " deskonly" : "")}>
          <button className="iconbtn back" onClick={() => navigate("/")} aria-label={t("ui_back")}><Icon name="back" /></button>
          <h1 className="grow">{title}</h1>
        </div>
        {lead ? <p className="lead">{lead}</p> : null}
        {children}
      </div>
    </main>
  );
}

export function PeoplePage() {
  const [tab, setTab] = useState<"friends" | "requests" | "search" | "feed">("friends");
  const requests = useStore((s) => s.requests);
  return (
    <PageShell title={t("ui_people_title")} tab>
      <div className="tabs" role="tablist">
        {([["friends", t("ui_friends")], ["requests", t("ui_requests") + (requests.friends + requests.dms ? ` (${requests.friends + requests.dms})` : "")], ["search", t("ui_find_people")], ["feed", t("ui_activity")]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={"chip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === "friends" ? <Friends /> : null}
      {tab === "requests" ? <Requests /> : null}
      {tab === "search" ? <FindPeople /> : null}
      {tab === "feed" ? <Feed /> : null}
    </PageShell>
  );
}

/** Opens our chat, or asks for one; true when it was asked (not opened). */
async function openDm(userId: number): Promise<boolean> {
  try {
    const res = await api.openDm(userId);
    if (res.conversation_id) {
      await loadConversations();
      navigate(chatPath(res.conversation_id));
      return false;
    }
    toast(t("ui_dm_request_sent"));
    return true;
  } catch (e: any) {
    toast(e.message, "error");
    return false;
  }
}

function Friends() {
  const [friends, setFriends] = useState<any[] | null>(null);
  useEffect(() => {
    api.friends().then(setFriends).catch(() => setFriends([]));
  }, []);
  if (!friends) return <div className="empty">{t("ui_loading")}</div>;
  if (!friends.length) return <div className="empty"><h3>{t("ui_no_friends_yet")}</h3><p>{t("ui_no_friends_hint")}</p></div>;
  return (
    <div className="box plist">
      {friends.map((f) => (
        <div key={f.id} className="item">
          <Avatar user={f} size={36} online={f.online} />
          <div className="grow">{f.display_name}<div className="muted" style={{ fontSize: 12 }}>{f.online ? t("ui_online") : t("ui_offline")}</div></div>
          <button className="btn sm pri" onClick={() => openDm(f.id)}>{t("ui_write")}</button>
        </div>
      ))}
    </div>
  );
}

function Requests() {
  const [friendReqs, setFriendReqs] = useState<any[]>([]);
  const [dmReqs, setDmReqs] = useState<any[]>([]);
  const load = () => {
    api.friendRequests().then(setFriendReqs).catch(() => undefined);
    api.dmRequests().then(setDmReqs).catch(() => undefined);
    refreshRequests();
  };
  useEffect(load, []);
  async function friend(id: number, accept: boolean) {
    await api.resolveFriend(id, accept).catch((e) => toast(e.message, "error"));
    load();
  }
  async function dm(id: number, accept: boolean) {
    try {
      const res = await api.resolveDm(id, accept);
      load();
      if (res.conversation_id) {
        await loadConversations();
        navigate(chatPath(res.conversation_id));
      }
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  if (!friendReqs.length && !dmReqs.length) return <div className="empty">{t("ui_no_requests")}</div>;
  return (
    <div className="stack">
      {dmReqs.length ? <h2>{t("ui_dm_requests")}</h2> : null}
      {dmReqs.map((r) => (
        <div key={r.id} className="box row">
          <Avatar user={r.from_user} size={36} />
          <div className="grow">{t("ui_wants_to_write", { name: r.from_user.display_name })}</div>
          <button className="btn sm pri" onClick={() => dm(r.id, true)}>{t("ui_accept")}</button>
          <button className="btn sm" onClick={() => dm(r.id, false)}>{t("ui_decline")}</button>
        </div>
      ))}
      {friendReqs.length ? <h2>{t("ui_friend_requests")}</h2> : null}
      {friendReqs.map((r) => (
        <div key={r.id} className="box row">
          <Avatar user={r.from_user} size={36} />
          <div className="grow">{t("ui_wants_friend", { name: r.from_user?.display_name })}</div>
          <button className="btn sm pri" onClick={() => friend(r.id, true)}>{t("ui_accept")}</button>
          <button className="btn sm" onClick={() => friend(r.id, false)}>{t("ui_decline")}</button>
        </div>
      ))}
    </div>
  );
}

function FindPeople() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const id = window.setTimeout(() => api.searchUsers(q).then(setRes).catch(() => setRes([])), 300);
    return () => window.clearTimeout(id);
  }, [q]);
  return (
    <div className="stack">
      <div className="search"><Icon name="search" size="sm" /><input id="people-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_search_people")} /></div>
      <div className="box plist">
        {res.map((p) => (
          <div key={p.id} className="item">
            <Avatar user={p} size={36} online={p.online} />
            <div className="grow">{p.display_name}<div className="muted" style={{ fontSize: 12 }}>{p.province}</div></div>
            {/* friendship, and a private chat: with friends at once; with others only if they accept private messages */}
            {!p.friend ? (
              p.friend_requested
                ? <button className="btn sm" disabled>{t("ui_friend_request_pending")} ✓</button>
                : <button className="btn sm" onClick={() => api.friendRequest(p.id).then(() => {
                  toast(t("ui_friend_request_sent_to", { name: p.display_name }));
                  setRes((xs) => xs.map((x) => (x.id === p.id ? { ...x, friend_requested: true } : x)));
                }).catch((e) => toast(e.message, "error"))}>{t("ui_add_friend")}</button>
            ) : null}
            {p.friend ? <button className="btn sm pri" onClick={() => openDm(p.id)}>{t("ui_write")}</button>
              : p.dm_requested ? <button className="btn sm" disabled>{t("ui_dm_request_pending")} ✓</button>
              : p.accept_dm ? <button className="btn sm pri" title={t("ui_ask_dm_hint")} onClick={() => openDm(p.id).then((asked) => {
                if (asked) setRes((xs) => xs.map((x) => (x.id === p.id ? { ...x, dm_requested: true } : x)));
              })}>{t("ui_ask_dm")}</button> : null}
          </div>
        ))}
        {!res.length ? <div className="muted" style={{ padding: 8 }}>{t("ui_search_people_hint")}</div> : null}
      </div>
    </div>
  );
}

function Feed() {
  const [posts, setPosts] = useState<any[] | null>(null);
  const [text, setText] = useState("");
  const load = () => api.feed().then(setPosts).catch(() => setPosts([]));
  useEffect(() => {
    load();
  }, []);
  async function post() {
    try {
      await api.post(text.trim());
      setText("");
      load();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  return (
    <div className="stack">
      <div className="box stack">
        <textarea id="feed-post" className="inp" rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("ui_feed_placeholder")} />
        <div className="row"><span className="muted grow" style={{ fontSize: 12 }}>{t("ui_feed_hint")}</span><button className="btn pri sm" disabled={!text.trim()} onClick={post}>{t("ui_publish")}</button></div>
      </div>
      {posts?.map((p) => (
        <div key={p.id} className="box">
          <div className="row"><Avatar user={p.user} size={32} /><b>{p.user.display_name}</b><span className="muted" style={{ fontSize: 12 }}>{dayLabel(p.created_at)} · {timeOf(p.created_at)}</span></div>
          <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{p.content}</div>
        </div>
      ))}
      {posts && !posts.length ? <div className="empty">{t("ui_feed_empty")}</div> : null}
    </div>
  );
}

export function MentionsPage() {
  const conversations = useStore((s) => s.conversations);
  const [items, setItems] = useState<Message[] | null>(null);
  useEffect(() => {
    api.mentions().then(setItems).catch(() => setItems([]));
  }, []);
  return (
    <PageShell title={t("ui_mentions_title")} lead={t("ui_mentions_lead")}>
      <div className="box plist">
        {items?.map((m) => {
          const c = conversations[m.conversation_id];
          return (
            <button key={m.id} className="item" style={{ width: "100%", textAlign: "left" }} onClick={() => navigate(chatPath(m.conversation_id, m.thread_root_id && !m.also_in_channel ? { thread: m.thread_root_id } : { around: m.id }))}>
              <Avatar user={m.sender} size={34} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="muted" style={{ fontSize: 12 }}>{m.sender?.display_name} · {c ? convTitle(c) : ""} · {dayLabel(m.created_at)} {timeOf(m.created_at)}</div>
                <div style={{ overflowWrap: "anywhere" }}>{m.body}</div>
              </div>
            </button>
          );
        })}
        {items && !items.length ? <div className="empty">{t("ui_no_mentions")}</div> : null}
        {!items ? <div className="empty">{t("ui_loading")}</div> : null}
      </div>
    </PageShell>
  );
}

export function AccountPage() {
  const me = useStore((s) => s.me)!;
  const billing = useStore((s) => s.billing);
  const subscriptions = useStore((s) => s.subscriptions);
  // Plans only show while subscriptions are on, or for someone who already pays.
  const showPlans = subscriptions || !!billing?.stripe || !!billing?.play;
  const [form, setForm] = useState({ display_name: me.display_name, bio: me.bio || "", accept_dm: me.accept_dm });
  // Zone: province (any time) and date of birth (once); together they decide your channels.
  const [zone, setZone] = useState({ country: me.country || "ES", province: me.province, dob: me.dob });
  const [geo, setGeo] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [mine, setMine] = useState<string[]>([]);
  // "on" only when this browser has a real subscription; "denied" when the browser blocks notifications.
  const [pushState, setPushState] = useState<"on" | "off" | "denied" | "busy">(webPushPermission() === "denied" ? "denied" : "off");
  useEffect(() => {
    webPushSubscribed().then((on) => setPushState((s) => (s === "denied" ? s : on ? "on" : "off"))).catch(() => undefined);
  }, []);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("theme") || "system";
    } catch {
      return "system";
    }
  });
  const [lang, setLangState] = useState(getLang());
  // The tab is in the address (?section=…): the avatar's menu opens My profile or Settings, also from this page.
  type Section = "profile" | "interests" | "notifications" | "plan" | "settings";
  const route = useRoute();
  const fromUrl = (): Section => {
    const s = queryParam("section");
    return s === "interests" || s === "notifications" || s === "plan" || s === "settings" ? s : "profile";
  };
  const [section, setSectionState] = useState<Section>(fromUrl);
  useEffect(() => setSectionState(fromUrl()), [route]);
  const setSection = (s: Section) => {
    setSectionState(s);
    navigate(s === "profile" ? "/account" : `/account?section=${s}`, true);
  };

  useEffect(() => {
    api.interests().then(setInterests).catch(() => undefined);
    api.myInterests().then(setMine).catch(() => undefined);
    api.publicSettings().then(setGeo).catch(() => setGeo({}));
    refreshBilling();
  }, []);

  async function saveProfile() {
    try {
      const zoneChanged = zone.province !== me.province || (zone.country || "ES") !== (me.country || "ES");
      const dobChanged = zone.dob !== me.dob;
      const updated = await api.updateProfile({
        ...form,
        ...(zoneChanged ? { country: zone.country, province: zone.province } : {}), ...(dobChanged ? { dob: zone.dob } : {}),
      });
      setState({ me: updated });
      if (zoneChanged || dobChanged) await loadConversations();
      toast(t("ui_saved"));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function changePassword() {
    if (password.length < 6) return toast(t("ui_password_new"), "error");
    if (password !== password2) return toast(t("ui_password_mismatch"), "error");
    try {
      const updated = await api.updateProfile({ password });
      setState({ me: updated });
      setPassword("");
      setPassword2("");
      toast(t("ui_password_changed"));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function toggleInterest(slug: string) {
    const next = mine.includes(slug) ? mine.filter((s) => s !== slug) : [...mine, slug];
    setMine(next);
    try {
      await api.setInterests(next);
      await loadConversations();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function togglePush() {
    if (pushState === "on") {
      setPushState("busy");
      await disableWebPush().catch(() => undefined);
      setPushState("off");
      toast(t("ui_push_off"));
      return;
    }
    setPushState("busy");
    let ok = false;
    try {
      ok = await enableWebPush();
    } catch (e) {
      console.error("Web Push", e);
    }
    const denied = webPushPermission() === "denied";
    setPushState(ok ? "on" : denied ? "denied" : "off");
    toast(ok ? t("ui_push_on") : denied ? t("ui_push_denied") : t("ui_push_failed"), ok ? "info" : "error");
  }

  function changeTheme(value: string) {
    setTheme(value);
    try {
      localStorage.setItem("theme", value);
    } catch {
      /* per-device preference */
    }
    applyTheme(value);
  }
  function changeLang(value: string) {
    setLang(value);
    setLangState(value);
    window.location.reload();
  }

  const ageLabel = (me.age_range || "").replace("_plus", "+").replace("_", "-");
  const tabs: [Section, string, string][] = [
    ["profile", "user", t("ui_acc_tab_profile")], ["interests", "star", t("ui_acc_tab_interests")], ["notifications", "bell", t("ui_acc_tab_notifications")],
    ...(showPlans ? [["plan", "ticket", t("ui_acc_tab_plan")] as [Section, string, string]] : []), ["settings", "sliders", t("ui_acc_tab_settings")],
  ];

  return (
    <PageShell title={t("ui_account_title")}>
      {/* who you are, and signing out always in view */}
      <div className="acchero">
        <Avatar user={me} size={60} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="acchero-name">{me.display_name}</div>
          <div className="acchero-meta">{me.email}</div>
          <div className="acchero-meta">{me.province}{ageLabel ? ` · ${ageLabel}` : ""}</div>
        </div>
        {/* stacked, so they always fit beside the name on a phone */}
        <div className="acchero-acts">
          {me.role === "admin" ? <button className="btn sm acchero-admin" onClick={() => navigate("/admin")}><Icon name="shield" size="sm" />{t("ui_nav_admin")}</button> : null}
          <button className="btn sm danger acchero-out" onClick={signOut}><Icon name="logout" size="sm" />{t("ui_logout")}</button>
        </div>
      </div>

      {/* an icon above a short name: every tab fits on a phone */}
      <div className="acctabs" role="tablist">
        {tabs.map(([key, icon, label]) => (
          <button key={key} role="tab" aria-selected={section === key} className={section === key ? "on" : ""} onClick={() => setSection(key)}>
            <Icon name={icon} /><span>{label}</span>
          </button>
        ))}
      </div>

      {section === "plan" ? (
        <div className="box stack">
          <div className="row"><Icon name="star" /><b className="grow">{describeBilling(billing)}</b></div>
          {billing?.stripe ? (
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn sm" onClick={() => api.portal().then((r) => (window.location.href = r.url)).catch((e) => toast(e.message, "error"))}>{t("ui_manage_payment")}</button>
              <button className="btn sm" onClick={() => api.changePlan(billing.stripe!.plan === "yearly" ? "monthly" : "yearly").then((b) => setState({ billing: b })).catch((e) => toast(e.message, "error"))}>{billing.stripe.plan === "yearly" ? t("ui_switch_monthly") : t("ui_switch_yearly")}</button>
              {billing.stripe.cancel_at_period_end
                ? <button className="btn sm" onClick={() => api.resumePlan().then((b) => setState({ billing: b })).catch((e) => toast(e.message, "error"))}>{t("ui_resume_plan")}</button>
                : <button className="btn sm danger" onClick={() => api.cancelPlan().then((b) => setState({ billing: b })).catch((e) => toast(e.message, "error"))}>{t("ui_cancel_plan")}</button>}
            </div>
          ) : null}
          {billing && (billing.source === null || billing.source === "grant") ? <PlanPicker /> : null}
        </div>
      ) : null}

      {section === "profile" ? (
        <div className="stack" style={{ gap: 14 }}>
          <div className="box stack">
            <h3 className="boxtitle">{t("ui_section_about")}</h3>
            <AvatarPicker />
            <label className="fld">{t("ui_display_name")}<input id="acc-name" className="inp" maxLength={64} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></label>
            <label className="fld">{t("ui_bio")}<textarea id="acc-bio" className="inp" rows={3} maxLength={500} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></label>
          </div>
          <div className="box stack">
            <h3 className="boxtitle">{t("ui_section_zone")}</h3>
            <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_zone_hint")}</div>
            <div className="grid2">
              <label className="fld">{t("ui_country")}
                <select id="acc-country" className="inp" value={zone.country} onChange={(e) => setZone({ ...zone, country: e.target.value, province: "" })}>
                  {countryOptions(geo?.countries).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>
              <label className="fld">{regionLabel(geo, zone.country)}
                {(geo?.provinces_by_country?.[zone.country] || []).length ? (
                  <select id="acc-province" className="inp" value={zone.province} onChange={(e) => setZone({ ...zone, province: e.target.value })}>
                    <option value="">{t("ui_choose")}</option>
                    {geo.provinces_by_country[zone.country].map((p: any) => <option key={p.value} value={p.value}>{p.name}</option>)}
                  </select>
                ) : <input id="acc-province" className="inp" value={zone.province} onChange={(e) => setZone({ ...zone, province: e.target.value })} />}
              </label>
            </div>
            <label className="fld">{t("ui_dob")}
              <input id="acc-dob" className="inp" type="date" value={zone.dob} disabled={me.dob_change_count >= 1} onChange={(e) => setZone({ ...zone, dob: e.target.value })} />
              <span className="muted" style={{ fontSize: 12 }}>{me.dob_change_count >= 1 ? t("ui_dob_locked") : t("ui_dob_once")}</span>
            </label>
          </div>
          <div className="box stack">
            <h3 className="boxtitle">{t("ui_section_privacy")}</h3>
            <label className="check"><input id="acc-dm" type="checkbox" checked={form.accept_dm} onChange={(e) => setForm({ ...form, accept_dm: e.target.checked })} />{t("ui_accept_dm")}</label>
          </div>
          <button className="btn pri block" onClick={saveProfile}>{t("ui_save")}</button>
          <div className="box stack">
            <h3 className="boxtitle">{t("ui_password")}</h3>
            <label className="fld">{t("ui_password_new")}<input id="acc-password" className="inp" type="password" minLength={6} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <label className="fld">{t("ui_password_repeat")}<input id="acc-password2" className="inp" type="password" minLength={6} autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} /></label>
            <button className="btn block" disabled={!password} onClick={changePassword}>{t("ui_password_save")}</button>
          </div>
        </div>
      ) : null}

      {section === "interests" ? (
        <div className="box stack">
          <div className="muted">{t("ui_interests_lead", { zone: me.province })}</div>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {interests.map((i) => <button key={i.slug} className={"chip" + (mine.includes(i.slug) ? " on" : "")} aria-pressed={mine.includes(i.slug)} onClick={() => toggleInterest(i.slug)}>{i.name}</button>)}
          </div>
        </div>
      ) : null}

      {section === "notifications" ? (
        <div className="stack" style={{ gap: 14 }}>
          <div className="box stack">
            <h3 className="boxtitle">{t("ui_section_push")}</h3>
            {isNativeApp ? (
              <button className="btn" onClick={() => native.openNotificationSettings()}>{t("ui_open_notification_settings")}</button>
            ) : webPushSupported() ? (
              <div className="row"><span className="grow">{pushState === "on" ? t("ui_push_enabled_here") : pushState === "denied" ? t("ui_push_blocked") : t("ui_push_disabled_here")}</span>
                <button className="btn sm" disabled={pushState === "denied" || pushState === "busy"} onClick={togglePush}>{pushState === "on" ? t("ui_disable") : t("ui_enable")}</button></div>
            ) : <div className="muted">{t("ui_push_unsupported")}</div>}
            <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_notifications_hint")}</div>
          </div>
          <div className="box stack">
            <h3 className="boxtitle">{t("ui_emails")}</h3>
            {!me.email_verified ? <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_emails_unverified")}</div> : null}
            {["mentions", "messages", "requests", "plans", "reports"].filter((k) => me.email_prefs && k in me.email_prefs).map((k) => (
              <label key={k} className="check">
                <input id={`acc-email-${k}`} type="checkbox" checked={!!me.email_prefs![k]}
                  onChange={(e) => api.emailPrefs({ [k]: e.target.checked }).then((u) => setState({ me: u })).catch((err) => toast(err.message, "error"))} />
                {t("ui_email_" + k)}
              </label>
            ))}
            <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_emails_hint")}</div>
          </div>
        </div>
      ) : null}

      {section === "settings" ? (
        <div className="stack" style={{ gap: 14 }}>
          <div className="box grid2">
            <div className="fld themefld">{t("ui_theme")}
              <ThemePicker value={theme} onChange={changeTheme} />
            </div>
            <ChatSizePicker />
            <label className="fld">{t("ui_language")}
              <select id="acc-lang" className="inp" value={lang} onChange={(e) => changeLang(e.target.value)}>
                {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {isNativeApp ? <button className="btn" onClick={() => native.changeServer()}>{t("ui_change_server")}</button> : null}
            <button className="btn danger" onClick={signOut}><Icon name="logout" size="sm" />{t("ui_logout")}</button>
          </div>
          <BlockedPeople />
          <DeleteAccount />
        </div>
      ) : null}
    </PageShell>
  );
}

export function SharePage() {
  const conversationMap = useStore((s) => s.conversations);
  const conversations = Object.values(conversationMap);
  const [shared] = useState(() => native.takeShared());
  const [busy, setBusy] = useState(false);
  async function shareTo(id: number) {
    setBusy(true);
    try {
      const ids: number[] = [];
      for (const f of shared.files || []) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        const res = await api.upload(new Blob([bytes], { type: f.mime }), f.name);
        ids.push(res.id);
      }
      await sendMessage(id, { body: shared.text || "", client_id: crypto.randomUUID?.() || String(Date.now()), attachment_ids: ids });
      navigate(chatPath(id), true);
    } catch (e: any) {
      toast(e.message, "error");
      setBusy(false);
    }
  }
  const nothing = !shared.text && !(shared.files || []).length;
  return (
    <PageShell title={t("ui_share_title")} lead={nothing ? t("ui_share_nothing") : t("ui_share_lead", { n: (shared.files || []).length })}>
      {shared.text ? <div className="box" style={{ marginBottom: 12, whiteSpace: "pre-wrap" }}>{shared.text}</div> : null}
      {!nothing ? (
        <div className="box plist">
          {conversations.map((c) => (
            <button key={c.id} className="item" style={{ width: "100%", textAlign: "left" }} disabled={busy} onClick={() => shareTo(c.id)}>
              <span className="grow">{convTitle(c)}</span><Icon name="send" size="sm" />
            </button>
          ))}
        </div>
      ) : null}
    </PageShell>
  );
}

export function JoinPage({ code }: { code: string }) {
  const [error, setError] = useState("");
  useEffect(() => {
    // Invitation links are communities' first; a link that is not one may still be a group's.
    api.joinCommunityCode(code).then(async (res) => {
      toast(t("ui_community_joined_link_toast"));
      await loadConversations().catch(() => undefined);
      loadMyCommunities();
      navigate(communityPath(res.community_id), true);
    }).catch((e) => {
      if (e.status !== 404) return setError(e.message);
      api.joinInvite(code).then(async (res) => {
        await loadConversations();
        navigate(chatPath(res.conversation_id), true);
      }).catch((err) => setError(err.message));
    });
  }, [code]);
  return <PageShell title={t("ui_join_group")}>{error ? <div className="err">{error}</div> : <div className="empty">{t("ui_loading")}</div>}</PageShell>;
}

/** The colour themes as swatches: the system's, then the light ones and the dark ones (see THEMES in App.tsx). */
function ThemePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // a tiny window of the app in each theme: its background, side panel, top bar, two messages and a button
  const mini = (th: (typeof THEMES)[string]) => (
    <span className="tp" style={{ background: th.bg, color: th.dark ? "rgba(255,255,255,.55)" : "rgba(15,26,46,.45)" }}>
      <span className="tp-side" style={{ background: th.panel }} />
      <span className="tp-bar" style={{ background: `linear-gradient(90deg, ${th.accent}, ${th.accent2})` }} />
      <span className="tp-msg" style={{ background: th.panel }} />
      <span className="tp-msg me" style={{ background: `linear-gradient(135deg, ${th.accent}, ${th.accent2})` }} />
      <span className="tp-btn" style={{ background: th.accent }} />
    </span>
  );
  const swatch = (id: string) => (
    <button key={id} type="button" className={"themesw" + (value === id ? " on" : "")} aria-pressed={value === id} onClick={() => onChange(id)}>
      <span className="themesw-prev">{mini(THEMES[id])}</span>
      <span className="themesw-name">{t(THEMES[id].label)}</span>
    </button>
  );
  const ids = Object.keys(THEMES);
  return (
    <div className="themepick">
      <button type="button" className={"themesw sys" + (value === "system" ? " on" : "")} aria-pressed={value === "system"} onClick={() => onChange("system")}>
        <span className="themesw-prev split"><span className="half">{mini(THEMES.light)}</span><span className="half">{mini(THEMES.dark)}</span></span>
        <span className="themesw-name">{t("ui_theme_system")}</span>
      </button>
      <div className="themegroup">{t("ui_theme_light_group")}</div>
      {ids.filter((id) => !THEMES[id].dark).map(swatch)}
      <div className="themegroup">{t("ui_theme_dark_group")}</div>
      {ids.filter((id) => THEMES[id].dark).map(swatch)}
    </div>
  );
}

/** My photo: choose one (camera or gallery on a phone), or remove it; the server crops it square. */
function AvatarPicker() {
  const me = useStore((s) => s.me);
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  async function run(fn: () => Promise<any>) {
    setBusy(true);
    try {
      setState({ me: await fn() });
      toast(t("ui_saved"));
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="avpick">
      <button type="button" className="avpick-photo" onClick={() => input.current?.click()} aria-label={t("ui_avatar_change")} disabled={busy}>
        <Avatar user={me} size={88} />
        <span className="avpick-cam"><Icon name="camera" size="sm" /></span>
      </button>
      <div className="stack" style={{ gap: 6 }}>
        <button type="button" className="btn sm pri" disabled={busy} onClick={() => input.current?.click()}>{busy ? t("ui_uploading") : t("ui_avatar_change")}</button>
        {me.avatar_url ? <button type="button" className="btn sm" disabled={busy} onClick={() => run(() => api.deleteAvatar())}>{t("ui_avatar_remove")}</button> : null}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) run(() => api.uploadAvatar(f));
      }} />
    </div>
  );
}

/** People I blocked, to unblock them. */
function BlockedPeople() {
  const [list, setList] = useState<(UserSummary & { blocked_at: string })[] | null>(null);
  const load = () => api.blocks().then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="box stack">
      <h3 className="boxtitle">{t("ui_blocked_title")}</h3>
      {list && !list.length ? <div className="muted" style={{ fontSize: 13 }}>{t("ui_blocked_none")}</div> : null}
      {(list || []).map((u) => (
        <div key={u.id} className="row" style={{ gap: 10 }}>
          <Avatar user={u} size={32} />
          <span className="grow">{u.display_name}</span>
          <button className="btn sm" onClick={async () => {
            try {
              await api.unblock(u.id);
              toast(t("ui_unblocked_toast", { name: u.display_name }));
              load();
              loadBlocks();
            } catch (e: any) {
              toast(e.message, "error");
            }
          }}>{t("ui_unblock")}</button>
        </div>
      ))}
    </div>
  );
}

/** Deleting my account for good, with my password (Google Play asks every app with accounts to offer this). */
function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await api.deleteMe(password);
      toast(t("ui_delete_account_done"));
      signOut();
    } catch (e: any) {
      toast(e.message, "error");
      setBusy(false);
    }
  }
  return (
    <div className="box stack dangerbox">
      <h3 className="boxtitle">{t("ui_delete_account")}</h3>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("ui_delete_account_hint")}</p>
      {!open ? <div><button className="btn danger" onClick={() => setOpen(true)}><Icon name="trash" size="sm" />{t("ui_delete_account")}</button></div> : (
        <div className="stack" style={{ gap: 8 }}>
          <label className="fld">{t("ui_delete_account_password")}
            <input id="delete-password" className="inp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn danger" disabled={!password || busy} onClick={confirm}>{t("ui_delete_account_confirm")}</button>
            <button className="btn" disabled={busy} onClick={() => { setOpen(false); setPassword(""); }}>{t("ui_cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The text size of the whole app on this device: small, normal or large, with a preview. */
function ChatSizePicker() {
  const [size, setSize] = useState(() => document.documentElement.dataset.chatsize || "normal");
  const pick = (v: string) => {
    setSize(v);
    try {
      localStorage.setItem("chatSize", v);
    } catch {
      /* per-device preference */
    }
    applyChatSize(v);
  };
  const labels: Record<string, string> = { small: t("ui_chat_size_small"), normal: t("ui_chat_size_normal"), large: t("ui_chat_size_large") };
  return (
    <div className="fld">{t("ui_chat_size")}
      <div className="sizepick" role="radiogroup" aria-label={t("ui_chat_size")}>
        {CHAT_SIZES.map((k) => (
          <button key={k} id={`chat-size-${k}`} role="radio" aria-checked={size === k} className={"sz-" + k + (size === k ? " on" : "")} onClick={() => pick(k)}>
            <span className="aa">Aa</span><span>{labels[k]}</span>
          </button>
        ))}
      </div>
      <div className="sizeprev" data-size={size}>{t("ui_chat_size_preview")}</div>
    </div>
  );
}
