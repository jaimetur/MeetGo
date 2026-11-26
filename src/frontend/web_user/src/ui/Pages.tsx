import React, { useEffect, useState } from "react";
import { LANGUAGES, getLang, setLang, t } from "@lang";
import { api, fileUrl } from "../api";
import { isNativeApp, native } from "../native";
import { disableWebPush, enableWebPush, webPushPermission, webPushSubscribed, webPushSupported } from "../push";
import { chatPath, communityPath, navigate, queryParam, useRoute } from "../router";
import { loadBlocks, loadConversations, loadMyCommunities, setState, toast, useStore } from "../store";
import type { Interest, Message, UserSummary } from "../types";
import { dayLabel, timeOf } from "../util";
import { CHAT_SIZES, DESIGN_FAMILIES, THEMES, THEME_FAMILIES, type ThemeChoice, type ThemeMode, applyChatSize, readThemeChoice, saveThemeChoice, refreshBilling, refreshRequests, signOut } from "./App";
import { sendMessage } from "./Chat";
import { AboutModal, Avatar, Icon, LAYOUTS, applyLayout, getRailIcons, setRailIcons, type Layout, convTitle, getLayout, countryOptions, regionLabel, fullName, shownName } from "./common";
import { AliasField } from "./Auth";
import { AvatarCrop } from "./AvatarCrop";
import { PlanPicker, describeBilling } from "./Paywall";
import { PhoneTop } from "./Board";

function PageShell({ title, lead, children, tab }: { title: string; lead?: string; children: React.ReactNode; tab?: boolean }) {
  // `tab`: a screen of the phone's tab bar (People): the usual top bar instead of a back button
  return (
    <main className={"page" + (tab ? " tabpage" : "")}>
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
  // a notice can open a tab directly (?tab=requests: an invitation to a community)
  const [tab, setTab] = useState<"friends" | "requests" | "search">(() => (["friends", "requests", "search"] as const).find((k) => k === queryParam("tab")) || "friends");
  const requests = useStore((s) => s.requests);
  return (
    <PageShell title={t("ui_people_title")} tab>
      <div className="tabs" role="tablist">
        {([["friends", t("ui_friends")], ["requests", t("ui_requests") + (requests.friends + requests.dms + (requests.communities || 0) ? ` (${requests.friends + requests.dms + (requests.communities || 0)})` : "")], ["search", t("ui_find_people")]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={"chip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === "friends" ? <Friends /> : null}
      {tab === "requests" ? <Requests /> : null}
      {tab === "search" ? <FindPeople /> : null}
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
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof api.communityInvites>>>([]);
  const load = () => {
    api.friendRequests().then(setFriendReqs).catch(() => undefined);
    api.dmRequests().then(setDmReqs).catch(() => undefined);
    api.communityInvites().then(setInvites).catch(() => undefined);
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
  async function invite(id: number, accept: boolean) {
    try {
      const res = await api.resolveCommunityInvite(id, accept);
      load();
      if (res.community_id) {
        loadMyCommunities();
        await loadConversations().catch(() => undefined);
        navigate(communityPath(res.community_id));
      }
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  if (!friendReqs.length && !dmReqs.length && !invites.length) return <div className="empty">{t("ui_no_requests")}</div>;
  return (
    <div className="stack">
      {invites.length ? <h2>{t("ui_community_invites")}</h2> : null}
      {invites.map((r) => (
        <div key={r.id} className="box row">
          <Avatar user={r.from_user} size={36} />
          <div className="grow">{t("ui_invited_you", { name: r.from_user?.display_name || "—", community: r.community?.title || "—" })}</div>
          <button className="btn sm pri" onClick={() => invite(r.id, true)}>{t("ui_accept")}</button>
          <button className="btn sm" onClick={() => invite(r.id, false)}>{t("ui_decline")}</button>
        </div>
      ))}
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
  const me = useStore((s) => s.me);
  const [q, setQ] = useState("");
  const [where, setWhere] = useState<"province" | "country" | "all">("province");
  const [res, setRes] = useState<any[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const id = window.setTimeout(() => api.searchUsers(q, where).then(setRes).catch(() => setRes([])), 300);
    return () => window.clearTimeout(id);
  }, [q, where]);
  return (
    <div className="stack">
      {/* where to look: my province (the default), my whole country or anywhere */}
      <div className="peoplesearch">
        <div className="search"><Icon name="search" size="sm" /><input id="people-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_search_people")} /></div>
        <select id="people-where" className="inp" value={where} onChange={(e) => setWhere(e.target.value as typeof where)} aria-label={t("ui_people_where")}>
          <option value="province">{t("ui_people_where_province", { zone: me?.province || "" })}</option>
          <option value="country">{t("ui_people_where_country")}</option>
          <option value="all">{t("ui_people_where_all")}</option>
        </select>
      </div>
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

/** The tab of my account I was on, while the app stays open (opening it again starts on the first one). */
export const accountMemory = { section: "profile" };

export function AccountPage() {
  const me = useStore((s) => s.me)!;
  const billing = useStore((s) => s.billing);
  const subscriptions = useStore((s) => s.subscriptions);
  // Plans only show while subscriptions are on, or for someone who already pays.
  const showPlans = subscriptions || !!billing?.stripe || !!billing?.play;
  const [form, setForm] = useState({ display_name: me.display_name, first_name: me.first_name || "", last_name: me.last_name || "", bio: me.bio || "", accept_dm: me.accept_dm });
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
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);
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
  useEffect(() => {
    accountMemory.section = section;
  }, [section]);
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

  function changeTheme(value: ThemeChoice) {
    setTheme(value);
    saveThemeChoice(value);
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
          <div className="acchero-name">{shownName(me)}</div>
          {me.last_name ? <div className="acchero-meta">{fullName(me)}</div> : null}
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
            <div className="grid2">
              <label className="fld">{t("ui_first_name")}<input id="acc-first" className="inp" maxLength={64} autoComplete="given-name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></label>
              <label className="fld">{t("ui_last_name")}<input id="acc-last" className="inp" maxLength={96} autoComplete="family-name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></label>
            </div>
            <AliasField id="acc-name" value={form.display_name} onChange={(v) => setForm({ ...form, display_name: v })} />
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
            {interests.filter((i) => mine.includes(i.slug) || (i.active !== false && (!i.age_ranges?.length || i.age_ranges.includes(me.age_range)))).map((i) => <button key={i.slug} className={"chip" + (mine.includes(i.slug) ? " on" : "")} aria-pressed={mine.includes(i.slug)} onClick={() => toggleInterest(i.slug)}>{i.name}</button>)}
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
            {["mentions", "messages", "requests", "plans", "reports", "categories", "communities"].filter((k) => me.email_prefs && k in me.email_prefs).map((k) => (
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
          {/* each setting in its own panel: design, theme, text size, language */}
          <div className="box setbox"><LayoutPicker theme={theme} onTheme={changeTheme} /></div>
          <div className="box setbox">
            <div className="fld themefld">{t("ui_theme")}
              <ThemePicker value={theme} onChange={changeTheme} />
            </div>
          </div>
          <div className="box setbox"><ChatSizePicker /></div>
          <div className="box setbox">
            <label className="fld setfld">{t("ui_language")}
              <select id="acc-lang" className="inp" value={lang} onChange={(e) => changeLang(e.target.value)}>
                {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
          </div>
          {isNativeApp ? (
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn" onClick={() => native.changeServer()}>{t("ui_change_server")}</button>
            </div>
          ) : null}
          <PrivacyBox />
          <CalendarFeed />
          <BlockedPeople />
          <DeleteAccount />
          <AboutButton />
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
// a tiny window of the app in each theme: its background, side panel, top bar, two messages and a button
const themeMini = (th: (typeof THEMES)[string]) => (
    <span className="tp" style={{ background: th.bg, color: th.dark ? "rgba(255,255,255,.55)" : "rgba(15,26,46,.45)" }}>
      <span className="tp-side" style={{ background: th.panel }} />
      <span className="tp-bar" style={{ background: `linear-gradient(90deg, ${th.accent}, ${th.accent2})` }} />
      <span className="tp-msg" style={{ background: th.panel }} />
      <span className="tp-msg me" style={{ background: `linear-gradient(135deg, ${th.accent}, ${th.accent2})` }} />
      <span className="tp-btn" style={{ background: th.accent }} />
    </span>
);

/** One swatch per theme (its day and night versions), the seven of the designs first, and a Day / Night / Auto switch. */
function ThemePicker({ value, onChange }: { value: ThemeChoice; onChange: (v: ThemeChoice) => void }) {
  const mini = themeMini;
  const modes: [ThemeMode, string, string][] = [["light", "sun", "ui_theme_mode_light"], ["dark", "moon", "ui_theme_mode_dark"], ["auto", "monitor", "ui_theme_mode_auto"]];
  const swatch = (key: string) => {
    const f = THEME_FAMILIES[key];
    return (
      <button key={key} id={`theme-${key}`} type="button" className={"themesw" + (value.family === key ? " on" : "")} aria-pressed={value.family === key}
        onClick={() => onChange({ ...value, family: key })}>
        {value.mode === "auto"
          ? <span className="themesw-prev split"><span className="half">{mini(THEMES[f.light])}</span><span className="half">{mini(THEMES[f.dark])}</span></span>
          : <span className="themesw-prev">{mini(THEMES[value.mode === "dark" ? f.dark : f.light])}</span>}
        <span className="themesw-name">{t(f.label)}</span>
      </button>
    );
  };
  const others = Object.keys(THEME_FAMILIES).filter((k) => !DESIGN_FAMILIES.includes(k));
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="modepick" role="radiogroup" aria-label={t("ui_theme_mode")}>
        {modes.map(([m, icon, label]) => (
          <button key={m} id={`theme-mode-${m}`} type="button" role="radio" aria-checked={value.mode === m} className={value.mode === m ? "on" : ""}
            onClick={() => onChange({ ...value, mode: m })}><Icon name={icon} size="sm" />{t(label)}</button>
        ))}
      </div>
      <div className="themepick">
        <div className="themegroup">{t("ui_theme_group_designs")}</div>
        {DESIGN_FAMILIES.map(swatch)}
        <div className="themegroup">{t("ui_theme_group_more")}</div>
        {others.map(swatch)}
      </div>
    </div>
  );
}

/** My photo: choose one (camera or gallery on a phone), or remove it; the server crops it square. */
function AvatarPicker() {
  const me = useStore((s) => s.me);
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [crop, setCrop] = useState<File | null>(null);  // the photo chosen, to frame before uploading it
  if (!me) return null;
  // my current photo, whole (as uploaded; the framed one for photos from before), to frame it again
  async function adjust() {
    if (!me?.avatar_url) return;
    setBusy(true);
    try {
      const r = await fetch(fileUrl(me.avatar_url.replace("/avatars/", "/avatars/orig/")));
      if (!r.ok) throw new Error(t("err_file_not_found"));
      setCrop(new File([await r.blob()], "avatar.webp", { type: "image/webp" }));
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
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
        {me.avatar_url ? <button id="avatar-adjust" type="button" className="btn sm" disabled={busy} onClick={() => adjust()}>{t("ui_avatar_adjust")}</button> : null}
        {me.avatar_url ? <button type="button" className="btn sm" disabled={busy} onClick={() => run(() => api.deleteAvatar())}>{t("ui_avatar_remove")}</button> : null}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) setCrop(f);
      }} />
      {crop ? <AvatarCrop file={crop} onCancel={() => setCrop(null)} onDone={(cut) => { const whole = crop; setCrop(null); run(() => api.uploadAvatar(cut, whole)); }} /> : null}
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
/** Privacy as in WhatsApp: read receipts (blue ticks) and who sees my "last seen"; both work both ways. */
function PrivacyBox() {
  const me = useStore((s) => s.me);
  if (!me) return null;
  const save = (patch: Record<string, unknown>) => api.updateProfile(patch).then((u) => { setState({ me: u }); toast(t("ui_saved")); }).catch((e) => toast(e.message, "error"));
  return (
    <section className="box stack">
      <h3 className="boxtitle"><Icon name="lock" size="sm" /> {t("ui_privacy_title")}</h3>
      <label className="tgl" htmlFor="acc-read-receipts">
        <span className="grow">{t("ui_privacy_receipts")}<small>{t("ui_privacy_receipts_hint")}</small></span>
        <input id="acc-read-receipts" type="checkbox" role="switch" checked={me.read_receipts !== false} onChange={(e) => save({ read_receipts: e.target.checked })} />
        <span className="sw" aria-hidden="true" />
      </label>
      <label className="fld setfld">{t("ui_privacy_last_seen")}
        <select id="acc-last-seen" className="inp" value={me.last_seen_privacy || "all"} onChange={(e) => save({ last_seen_privacy: e.target.value })}>
          <option value="all">{t("ui_privacy_everyone")}</option>
          <option value="friends">{t("ui_privacy_friends")}</option>
          <option value="nobody">{t("ui_privacy_nobody")}</option>
        </select>
        <small className="muted">{t("ui_privacy_last_seen_hint")}</small>
      </label>
    </section>
  );
}

/** My plans as a calendar the phone (or Google) subscribes to and keeps up to date. */
function CalendarFeed() {
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = path ? fileUrl(path) : "";
  const webcal = url.replace(/^https?:/, "webcal:");
  const get = (reset = false) => {
    setBusy(true);
    api.myCalendar(reset).then((r) => { setPath(r.path); if (reset) toast(t("ui_calendar_reset_done")); })
      .catch((e) => toast(e.message, "error")).finally(() => setBusy(false));
  };
  return (
    <section className="box stack">
      <h3 className="boxtitle"><Icon name="calendar" size="sm" /> {t("ui_calendar_title")}</h3>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("ui_calendar_hint")}</p>
      {!path ? <div><button id="acc-calendar" className="btn" disabled={busy} onClick={() => get()}>{t("ui_calendar_get")}</button></div> : (
        <>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <a className="btn pri" href={webcal}><Icon name="calendar" size="sm" />{t("ui_calendar_subscribe")}</a>
            <a className="btn" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer">Google Calendar</a>
          </div>
          <div className="copyrow">
            <input className="inp" readOnly value={url} onFocus={(e) => e.target.select()} />
            <button className="btn" onClick={() => navigator.clipboard?.writeText(url).then(() => toast(t("ui_copied"))).catch(() => undefined)}><Icon name="copy" size="sm" />{t("ui_copy")}</button>
          </div>
          <small className="muted">{t("ui_calendar_private")} <button className="linkbtn" disabled={busy} onClick={() => get(true)}>{t("ui_calendar_reset")}</button></small>
        </>
      )}
    </section>
  );
}

function AboutButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button id="acc-about" className="btn aboutbtn" onClick={() => setOpen(true)}><Icon name="info" size="sm" />{t("ui_about_title")}</button>
      {open ? <AboutModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** How the list of communities looks (this device): the cards as they were or one of the five styles. */
/** A small drawing of each design: how its lists and cards look. */
function LayoutMini({ k }: { k: Layout }) {
  const card = (n: number) => Array.from({ length: n }, (_, i) => <span key={i} className="lm-card"><span className="lm-cover" /><span className="lm-ic" /><span className="lm-l" /><span className="lm-l s" /><span className="lm-btn" /></span>);
  const row = (n: number) => Array.from({ length: n }, (_, i) => <span key={i} className="lm-row"><span className="lm-av" /><span className="lm-lines"><span className="lm-l" /><span className="lm-l s" /></span><span className="lm-dot" /></span>);
  if (k === "momentos") return <span className="lm lm-momentos"><span className="lm-rings">{[0, 1, 2, 3].map((i) => <span key={i} className={"lm-ring" + (i < 2 ? " on" : "")} />)}</span>{card(1)}</span>;
  if (k === "chispa") return <span className="lm lm-chispa"><span className="lm-hero"><span className="lm-l" /><span className="lm-l s" /></span><span className="lm-acts"><span /><span className="on" /><span /></span></span>;
  if (k === "quedadas") return <span className="lm lm-quedadas"><span className="lm-plans">{[0, 1, 2].map((i) => <span key={i} className="lm-plan"><span className="lm-date" /></span>)}</span>{row(2)}</span>;
  if (k === "mosaico") return <span className="lm lm-mosaico">{[0, 1, 2].map((c) => <span key={c} className="lm-col">{card(c === 1 ? 1 : 2)}</span>)}</span>;
  if (k === "conversa") return <span className="lm lm-conversa">{row(4)}</span>;
  if (k === "muro") return <span className="lm lm-muro">{card(2)}</span>;
  return <span className="lm lm-actual">{card(4)}</span>;
}

/** Each design's own theme (with its day and night versions): choosing the design applies it. */
const LAYOUT_THEMES: Record<Layout, string> = { actual: "meetgo", conversa: "conversa", momentos: "momentos", muro: "muro", chispa: "chispa", quedadas: "quedadas", mosaico: "mosaico" };

function LayoutPicker({ theme, onTheme }: { theme: ThemeChoice; onTheme: (v: ThemeChoice) => void }) {
  const [value, setValue] = useState<Layout>(getLayout);
  const [rail, setRail] = useState(getRailIcons);
  const pick = (v: Layout) => {
    setValue(v);
    try {
      localStorage.setItem("communityLayout", v);
    } catch {
      /* per-device preference */
    }
    applyLayout(v);
    // the design brings its theme, by day, night or auto as I had it; the themes below can change it afterwards
    onTheme({ family: LAYOUT_THEMES[v], mode: theme.mode });
  };
  return (
    <div className="fld setfld layoutfld">{t("ui_layout")}
      <div className="layoutpick" role="radiogroup" aria-label={t("ui_layout")}>
        {LAYOUTS.map((k) => (
          <button key={k} id={`layout-${k}`} type="button" role="radio" aria-checked={value === k} className={"lp-" + k + (value === k ? " on" : "")} onClick={() => pick(k)}>
            <span className="lp-prev" aria-hidden="true"><LayoutMini k={k} /></span>
            <span>{t("ui_layout_" + k)}</span>
          </button>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_layout_hint")}</div>
      <label className="tgl railtgl" htmlFor="set-rail-icons">
        <span className="grow">{t("ui_rail_icons")}<small>{t("ui_rail_icons_hint")}</small></span>
        <input id="set-rail-icons" type="checkbox" role="switch" checked={rail} onChange={(e) => { setRail(e.target.checked); setRailIcons(e.target.checked); }} />
        <span className="sw" aria-hidden="true" />
      </label>
    </div>
  );
}

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
    <div className="fld setfld">{t("ui_chat_size")}
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
