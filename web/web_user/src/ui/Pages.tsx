import React, { useEffect, useState } from "react";
import { getLang, setLang, t } from "@lang";
import { api } from "../api";
import { isNativeApp, native } from "../native";
import { disableWebPush, enableWebPush, webPushPermission, webPushSupported } from "../push";
import { chatPath, navigate } from "../router";
import { loadConversations, setState, toast, useStore } from "../store";
import type { Interest, Message } from "../types";
import { dayLabel, timeOf } from "../util";
import { applyTheme, refreshBilling, refreshRequests, signOut } from "./App";
import { sendMessage } from "./Chat";
import { Avatar, Icon, convTitle } from "./common";
import { PlanPicker, describeBilling } from "./Paywall";

function PageShell({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <main className="page">
      <div className="wrapw">
        <div className="row">
          <button className="iconbtn back" onClick={() => navigate("/")} aria-label={t("ui_back")}><Icon name="back" /></button>
          <h1 className="grow">{title}</h1>
        </div>
        {lead ? <p className="lead">{lead}</p> : null}
        {children}
      </div>
    </main>
  );
}

export function ExplorePage() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.explore>> | null>(null);
  const load = () => api.explore().then(setItems).catch((e) => toast(e.message, "error"));
  useEffect(() => {
    load();
  }, []);
  async function join(interestId: number) {
    try {
      const { conversation_id } = await api.joinChannel(interestId);
      await loadConversations();
      navigate(chatPath(conversation_id));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  const zone = items?.[0]?.zone;
  return (
    <PageShell title={t("ui_explore_title")} lead={zone ? t("ui_explore_lead", { zone }) : undefined}>
      <div className="grid2">
        {items?.map((c) => (
          <div key={c.interest.id} className="box row" style={{ gap: 12 }}>
            <div className="chan" style={{ width: 42, height: 42, fontSize: 19 }}>#</div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650 }}>{c.interest.name}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_members_n", { n: c.member_count })}</div>
            </div>
            {c.joined && c.conversation_id
              ? <button className="btn sm" onClick={() => navigate(chatPath(c.conversation_id!))}>{t("ui_open")}</button>
              : <button className="btn pri sm" onClick={() => join(c.interest.id)}>{t("ui_join")}</button>}
          </div>
        ))}
      </div>
      {!items ? <div className="empty">{t("ui_loading")}</div> : null}
    </PageShell>
  );
}

export function PeoplePage() {
  const [tab, setTab] = useState<"friends" | "requests" | "search" | "feed">("friends");
  const requests = useStore((s) => s.requests);
  return (
    <PageShell title={t("ui_people_title")}>
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

async function openDm(userId: number) {
  try {
    const res = await api.openDm(userId);
    if (res.conversation_id) {
      await loadConversations();
      navigate(chatPath(res.conversation_id));
    } else toast(t("ui_dm_request_sent"));
  } catch (e: any) {
    toast(e.message, "error");
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
            {!p.friend ? <button className="btn sm" onClick={() => api.friendRequest(p.id).then(() => toast(t("ui_friend_request_sent"))).catch((e) => toast(e.message, "error"))}>{t("ui_add_friend")}</button> : null}
            <button className="btn sm pri" disabled={!p.friend && !p.accept_dm} onClick={() => openDm(p.id)}>{p.friend ? t("ui_write") : t("ui_request")}</button>
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
  const [form, setForm] = useState({ display_name: me.display_name, bio: me.bio || "", accept_dm: me.accept_dm, avatar_url: me.avatar_url || "" });
  // Zone: province (any time) and date of birth (once); together they decide your channels.
  const [zone, setZone] = useState({ country: me.country || "ES", province: me.province, dob: me.dob });
  const [geo, setGeo] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [mine, setMine] = useState<string[]>([]);
  const [pushState, setPushState] = useState(webPushPermission());
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("theme") || "system";
    } catch {
      return "system";
    }
  });
  const [lang, setLangState] = useState(getLang());

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
        ...form, ...(password ? { password } : {}),
        ...(zoneChanged ? { country: zone.country, province: zone.province } : {}), ...(dobChanged ? { dob: zone.dob } : {}),
      });
      setState({ me: updated });
      setPassword("");
      if (zoneChanged || dobChanged) await loadConversations();
      toast(t("ui_saved"));
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
    if (pushState === "granted") {
      await disableWebPush();
      toast(t("ui_push_off"));
      return;
    }
    const ok = await enableWebPush().catch(() => false);
    setPushState(webPushPermission());
    toast(ok ? t("ui_push_on") : t("ui_push_denied"), ok ? "info" : "error");
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
  function changeLang(value: "es" | "en") {
    setLang(value);
    setLangState(value);
    window.location.reload();
  }

  return (
    <PageShell title={t("ui_account_title")}>
      <h2>{t("ui_subscription")}</h2>
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

      <h2>{t("ui_profile")}</h2>
      <div className="box stack">
        <div className="row"><Avatar user={me} size={52} /><div><b>{me.display_name}</b><div className="muted" style={{ fontSize: 12.5 }}>{me.email} · {me.province}</div></div></div>
        <label className="fld">{t("ui_display_name")}<input id="acc-name" className="inp" maxLength={64} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></label>
        <label className="fld">{t("ui_bio")}<textarea id="acc-bio" className="inp" rows={3} maxLength={500} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></label>
        <label className="fld">{t("ui_avatar_url")}<input id="acc-avatar" className="inp" value={form.avatar_url} onChange={(e) => setForm({ ...form, avatar_url: e.target.value })} placeholder="https://…" /></label>
        <div className="grid2">
          <label className="fld">{t("ui_country")}
            <select id="acc-country" className="inp" value={zone.country} onChange={(e) => setZone({ ...zone, country: e.target.value, province: "" })}>
              {(geo?.countries || [{ code: "ES", name: "España" }]).map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <label className="fld">{t("ui_province")}
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
        <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_zone_hint")}</div>
        <label className="check"><input id="acc-dm" type="checkbox" checked={form.accept_dm} onChange={(e) => setForm({ ...form, accept_dm: e.target.checked })} />{t("ui_accept_dm")}</label>
        <label className="fld">{t("ui_password_change")}<input id="acc-password" className="inp" type="password" minLength={6} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <div><button className="btn pri" onClick={saveProfile}>{t("ui_save")}</button></div>
      </div>

      <h2>{t("ui_interests")}</h2>
      <p className="lead">{t("ui_interests_lead", { zone: me.province })}</p>
      <div className="chips" style={{ flexWrap: "wrap" }}>
        {interests.map((i) => <button key={i.slug} className={"chip" + (mine.includes(i.slug) ? " on" : "")} aria-pressed={mine.includes(i.slug)} onClick={() => toggleInterest(i.slug)}>{i.name}</button>)}
      </div>

      <h2>{t("ui_notifications")}</h2>
      <div className="box stack">
        {isNativeApp ? (
          <button className="btn" onClick={() => native.openNotificationSettings()}>{t("ui_open_notification_settings")}</button>
        ) : webPushSupported() ? (
          <div className="row"><span className="grow">{pushState === "granted" ? t("ui_push_enabled_here") : pushState === "denied" ? t("ui_push_blocked") : t("ui_push_disabled_here")}</span>
            <button className="btn sm" disabled={pushState === "denied"} onClick={togglePush}>{pushState === "granted" ? t("ui_disable") : t("ui_enable")}</button></div>
        ) : <div className="muted">{t("ui_push_unsupported")}</div>}
        <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_notifications_hint")}</div>
      </div>

      <h2>{t("ui_appearance")}</h2>
      <div className="box grid2">
        <label className="fld">{t("ui_theme")}
          <select id="acc-theme" className="inp" value={theme} onChange={(e) => changeTheme(e.target.value)}>
            <option value="system">{t("ui_theme_system")}</option><option value="dark">{t("ui_theme_dark")}</option><option value="light">{t("ui_theme_light")}</option>
          </select>
        </label>
        <label className="fld">{t("ui_language")}
          <select id="acc-lang" className="inp" value={lang} onChange={(e) => changeLang(e.target.value as "es" | "en")}>
            <option value="es">Español</option><option value="en">English</option>
          </select>
        </label>
      </div>

      <h2>{t("ui_session")}</h2>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn danger" onClick={signOut}><Icon name="logout" size="sm" />{t("ui_logout")}</button>
        {isNativeApp ? <button className="btn" onClick={() => native.changeServer()}>{t("ui_change_server")}</button> : null}
      </div>
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
    api.joinInvite(code).then(async (res) => {
      await loadConversations();
      navigate(chatPath(res.conversation_id), true);
    }).catch((e) => setError(e.message));
  }, [code]);
  return <PageShell title={t("ui_join_group")}>{error ? <div className="err">{error}</div> : <div className="empty">{t("ui_loading")}</div>}</PageShell>;
}
