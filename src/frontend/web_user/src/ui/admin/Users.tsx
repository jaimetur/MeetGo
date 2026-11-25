/** The people of MeetGo: search, filters with counts, and a card per person with everything that can be done. */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@lang";
import { api as appApi } from "../../api";
import { api, type Plan, type UserActivity } from "../../../../web_admin/api";
import { madridYmd, planLabel } from "../../../../web_admin/strings";
import { toast, useStore } from "../../store";
import { Avatar, Icon, countryOptions, fullName, regionLabel, shownName } from "../common";
import { SectionHead } from "./AdminPage";
import { a, ago, duration, fmtDate, fmtDateTime } from "./i18n";
import { Badge, Choice, Empty, Field, Switch } from "./kit";

export type AdminUser = {
  id: number;
  display_name: string;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
  phone?: string | null;
  dob?: string | null;
  age_range?: string | null;
  country?: string | null;
  province?: string | null;
  city?: string | null;
  role?: string;
  bot_role?: string | null;
  email_verified?: boolean;
  is_banned?: boolean;
  banned_until?: string | null;
  login_count?: number;
  visit_count?: number;
  last_login_at?: string | null;
  last_seen_at?: string | null;
  total_connected_seconds?: number;
  session_active?: boolean;
  created_at?: string | null;
  online?: boolean;
  plan?: Plan;
};

type Filter = "all" | "online" | "active" | "admins" | "banned" | "unverified" | "paying" | "bots";
type Sort = "recent" | "seen" | "name";

const FILTERS: [Filter, string, (u: AdminUser) => boolean][] = [
  ["all", "us_f_all", (u) => !u.bot_role],
  ["online", "us_f_online", (u) => !!u.online],
  ["active", "us_f_active", (u) => !u.bot_role && !!u.last_seen_at && Date.now() - new Date(u.last_seen_at).getTime() < 7 * 864e5],
  ["admins", "us_f_admins", (u) => u.role === "admin"],
  ["banned", "us_f_banned", (u) => blocked(u)],
  ["unverified", "us_f_unverified", (u) => !u.bot_role && !u.email_verified],
  ["paying", "us_f_paying", (u) => !!u.plan && !["free", "none"].includes(u.plan.kind)],
  ["bots", "us_f_bots", (u) => !!u.bot_role],
];

export function blocked(u: AdminUser): boolean {
  return !!u.is_banned || (!!u.banned_until && new Date(u.banned_until).getTime() > Date.now());
}

const AGE: Record<string, string> = { "18_30": "18-30", "31_60": "31-60", "61_plus": "61+" };

export function Users({ initialFilter }: { initialFilter?: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(() => (FILTERS.some(([k]) => k === initialFilter) ? initialFilter as Filter : "all"));
  const [sort, setSort] = useState<Sort>("recent");
  const [open, setOpen] = useState<AdminUser | "new" | null>(null);

  const load = () => api.users().then((list: AdminUser[]) => setUsers(list || [])).catch((e) => { setUsers([]); toast(e.message, "error"); });
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k, , fn]) => [k, (users || []).filter(fn).length])), [users]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fn = FILTERS.find(([k]) => k === filter)![2];
    const list = (users || []).filter(fn).filter((u) => !needle || [u.display_name, fullName(u), u.email, u.phone, u.province].some((v) => (v || "").toLowerCase().includes(needle)));
    const time = (v?: string | null) => (v ? new Date(v).getTime() : 0);
    list.sort((x, y) => sort === "name" ? x.display_name.localeCompare(y.display_name, undefined, { sensitivity: "base" })
      : sort === "seen" ? (Number(!!y.online) - Number(!!x.online)) || time(y.last_seen_at) - time(x.last_seen_at)
        : time(y.created_at) - time(x.created_at) || y.id - x.id);
    return list;
  }, [users, q, filter, sort]);

  const changed = (u: AdminUser | null, removedId?: number) => {
    setUsers((list) => (list || []).flatMap((x) => (x.id === removedId ? [] : x.id === u?.id ? [{ ...x, ...u }] : [x])));
    if (u && open && open !== "new" && open.id === u.id) setOpen({ ...open, ...u });
  };

  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_users")} sub={users ? a("us_count", { n: counts.all }) : undefined}>
        <button id="adm-user-new" className="btn pri sm" onClick={() => setOpen("new")}><Icon name="plus" size="sm" />{a("us_new")}</button>
      </SectionHead>

      <div className="adm-toolbar">
        <div className="adm-search">
          <Icon name="search" size="sm" />
          <input id="adm-user-search" className="inp" type="search" placeholder={a("us_search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select id="adm-user-sort" className="inp adm-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={a("us_sort_recent")}>
          <option value="recent">{a("us_sort_recent")}</option>
          <option value="seen">{a("us_sort_seen")}</option>
          <option value="name">{a("us_sort_name")}</option>
        </select>
      </div>
      <div className="chips adm-chips" role="tablist">
        {FILTERS.map(([k, label]) => (
          <button key={k} id={`adm-users-${k}`} role="tab" aria-selected={filter === k} className={"chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>
            {a(label)} <span className="cnt">{counts[k] ?? 0}</span>
          </button>
        ))}
      </div>

      {users === null ? <div className="adm-loading">{a("loading")}</div> : shown.length === 0 ? <Empty icon="search" text={a("us_empty")} /> : (
        <div className="adm-list">
          {shown.map((u) => <UserRow key={u.id} u={u} onOpen={() => setOpen(u)} />)}
        </div>
      )}

      {open ? <UserCard user={open === "new" ? null : open} onClose={() => setOpen(null)}
        onChanged={(u) => changed(u)} onCreated={() => { setOpen(null); load(); }}
        onDeleted={(id) => { changed(null, id); setOpen(null); }} /> : null}
    </div>
  );
}

function UserBadges({ u }: { u: AdminUser }) {
  const plan = u.plan && !["free"].includes(u.plan.kind) ? planLabel(u.plan) : null;
  return (
    <>
      {u.bot_role ? <Badge tone="violet">{a("b_bot")}</Badge> : null}
      {u.role === "admin" ? <Badge tone="blue">{a("b_admin")}</Badge> : null}
      {blocked(u) ? <Badge tone="red">{u.banned_until && !u.is_banned ? a("b_banned_until", { date: fmtDate(u.banned_until) }) : a("b_banned")}</Badge> : null}
      {!u.bot_role && !u.email_verified ? <Badge tone="orange">{a("b_unverified")}</Badge> : null}
      {plan ? <Badge tone={plan.tone === "ok" ? "green" : plan.tone === "warn" ? "orange" : "gray"}>{plan.text}</Badge> : null}
    </>
  );
}

function UserRow({ u, onOpen }: { u: AdminUser; onOpen: () => void }) {
  const zone = [u.province, u.age_range ? AGE[u.age_range] || u.age_range : null].filter(Boolean).join(" · ");
  return (
    <button className={"adm-urow" + (blocked(u) ? " dim" : "")} onClick={onOpen}>
      <Avatar user={u} size={44} online={!!u.online} />
      <span className="adm-urow-main">
        <span className="adm-urow-name"><b>{shownName(u)}</b>{u.last_name ? <span className="muted">{u.last_name}</span> : null}<UserBadges u={u} /></span>
        <span className="adm-urow-meta">{u.email || u.phone || `#${u.id}`}</span>
        {zone ? <span className="adm-urow-meta"><Icon name="place" size="sm" />{zone}</span> : null}
      </span>
      <span className="adm-urow-side">
        {u.online ? <span className="adm-online">{a("us_online")}</span> : <span className="muted">{ago(u.last_seen_at)}</span>}
        <span className="adm-chev" aria-hidden="true">›</span>
      </span>
    </button>
  );
}

type Form = { display_name: string; first_name: string; last_name: string; email: string; phone: string; dob: string; country: string; province: string; city: string; password: string };

function formOf(u: AdminUser | null): Form {
  return {
    display_name: u?.display_name || "", first_name: u?.first_name || "", last_name: u?.last_name || "", email: u?.email || "", phone: u?.phone || "", dob: u?.dob || "",
    country: u?.country || "ES", province: u?.province || "", city: u?.city || "", password: "",
  };
}

/** A person's card: who they are, what they do, and every action (role, verification, block, free access, details, delete). */
function UserCard({ user, onClose, onChanged, onCreated, onDeleted }: {
  user: AdminUser | null; onClose: () => void; onChanged: (u: AdminUser) => void; onCreated: () => void; onDeleted: (id: number) => void;
}) {
  const me = useStore((s) => s.me);
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [geo, setGeo] = useState<any>(null);
  const [form, setForm] = useState<Form>(() => formOf(user));
  const [free, setFree] = useState<"none" | "date" | "lifetime">(() => (user?.plan?.kind === "gift" ? (user.plan.until ? "date" : "lifetime") : "none"));
  const [freeDate, setFreeDate] = useState(() => (user?.plan?.kind === "gift" && user.plan.until ? madridYmd(user.plan.until) : ""));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const isNew = !user;
  const self = !!user && user.id === me?.id;

  useEffect(() => {
    appApi.publicSettings().then(setGeo).catch(() => setGeo({}));
    if (user) api.userSummary(user.id).then(setActivity).catch(() => undefined);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user?.id]);

  const provinces = (geo?.provinces_by_country?.[form.country] || []) as { value: string; name: string }[];
  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v, ...(k === "country" ? { province: "" } : {}) }));

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      toast(e?.message || a("save_error"), "error");
    } finally {
      setBusy(false);
    }
  }

  const patch = (payload: Record<string, unknown>, done?: string) => run(async () => {
    const updated = await api.updateUser(user!.id, payload);
    onChanged({ ...user!, ...updated });
    toast(done || a("ud_saved"));
  });

  const saveData = () => run(async () => {
    const payload: Record<string, unknown> = { ...form };
    if (!form.password) delete payload.password;
    if (isNew) {
      await api.createUser(payload);
      toast(a("ud_created"));
      onCreated();
      return;
    }
    const updated = await api.updateUser(user!.id, payload);
    onChanged({ ...user!, ...updated });
    setForm((f) => ({ ...f, password: "" }));
    toast(a("ud_saved"));
  });

  const block = (days: number | null) => run(async () => {
    const r = await api.banUser(user!.id, days);
    onChanged({ ...user!, ...r });
    toast(a("ud_blocked"));
  });

  const blockState: string = !user ? "none" : user.is_banned ? "forever" : user.banned_until && new Date(user.banned_until).getTime() > Date.now() ? "until" : "none";
  const z = [user?.province, user?.age_range ? AGE[user.age_range] || user.age_range : null].filter(Boolean).join(" · ");

  return createPortal(
    <div className="modal-bg adm-sheet-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="adm-sheet" role="dialog" aria-modal="true" aria-label={user?.display_name || a("us_new")}>
        <header className="adm-sheet-head">
          {user ? <Avatar user={user} size={56} online={!!user.online} /> : <span className="adm-stat-ic t-blue"><Icon name="plus" /></span>}
          <div className="grow" style={{ minWidth: 0 }}>
            <h2>{user ? shownName(user) : a("us_new")}</h2>
            {user?.last_name ? <div className="adm-sheet-sub"><span>{fullName(user)}</span></div> : null}
            {user ? <div className="adm-sheet-sub">{user.online ? <span className="adm-online">{a("us_online")}</span> : <span>{a("ud_last_seen")}: {ago(user.last_seen_at)}</span>}{z ? <span>{z}</span> : null}</div> : null}
            {user ? <div className="adm-sheet-badges"><UserBadges u={user} />{self ? <Badge tone="teal">{a("ud_self")}</Badge> : null}</div> : null}
          </div>
          <button className="iconbtn" onClick={onClose} aria-label={a("close")}><Icon name="x" /></button>
        </header>

        <div className="adm-sheet-body">
          {user ? (
            <>
              <div className="adm-contact">
                {user.email ? <Copyable icon="at" text={user.email} /> : null}
                {user.phone ? <Copyable icon="chat" text={user.phone} /> : null}
              </div>
              <div className="adm-mini">
                {([["ud_messages", activity?.messages], ["ud_communities", activity?.communities], ["ud_groups", activity?.groups],
                  ["ud_friends", activity?.friends], ["ud_posts", activity?.posts], ["ud_reports", activity?.reports_received]] as [string, number | undefined][])
                  .map(([k, v]) => <div key={k} className={k === "ud_reports" && v ? "alert" : ""}><b>{v ?? "·"}</b><span>{a(k)}</span></div>)}
              </div>
              <div className="adm-facts">
                <div><span>{a("ud_joined")}</span><b>{fmtDate(user.created_at)}</b></div>
                {/* the app keeps the session open: the last activity and the visits say more than the sign-ins */}
                <div><span>{a("ud_last_access")}</span><b>{activity?.online || user.online ? a("ud_now") : fmtDateTime(user.last_seen_at || user.last_login_at)}</b></div>
                <div><span>{a("ud_visits")}</span><b>{user.visit_count ?? 0}</b></div>
                <div><span>{a("ud_time")}</span><b>{duration(activity?.connected_seconds ?? user.total_connected_seconds ?? 0)}</b></div>
                <div><span>{a("ud_last_login")}</span><b>{fmtDateTime(user.last_login_at)}</b></div>
                <div><span>{a("ud_logins")}</span><b>{user.login_count ?? 0}</b></div>
              </div>

              <section className="adm-block">
                <h3>{a("ud_access")}</h3>
                <Switch id="adm-u-admin" label={a("ud_role_admin")} hint={a("ud_role_admin_hint")} on={user.role === "admin"} disabled={busy || self}
                  onChange={(v) => patch({ role: v ? "admin" : "user" })} />
                <Switch id="adm-u-verified" label={a("ud_verified")} on={!!user.email_verified} disabled={busy}
                  onChange={(v) => patch({ email_verified: v })} />
                {!user.email_verified && user.email ? (
                  <button className="btn sm" disabled={busy} onClick={() => run(async () => { await api.resendVerification(user.id); toast(a("ud_resent")); })}>
                    <Icon name="send" size="sm" />{a("ud_resend")}
                  </button>
                ) : null}

                <div className="adm-sub">
                  <div className="adm-sub-head"><b>{a("ud_block")}</b>
                    <span className={blockState === "none" ? "muted" : "adm-red"}>{blockState === "forever" ? a("ud_block_state_forever")
                      : blockState === "until" ? a("ud_block_state_until", { date: fmtDateTime(user.banned_until) }) : a("ud_block_state_none")}</span>
                  </div>
                  <div className="adm-choice">
                    {([["0", "ud_block_none"], ["1", "ud_block_1"], ["7", "ud_block_7"], ["30", "ud_block_30"], ["x", "ud_block_forever"]] as [string, string][]).map(([v, k]) => {
                      const on = (v === "0" && blockState === "none") || (v === "x" && blockState === "forever");
                      return <button key={v} type="button" className={on ? "on" : ""} disabled={busy || self}
                        onClick={() => block(v === "x" ? null : Number(v))}>{a(k)}</button>;
                    })}
                  </div>
                </div>

                <div className="adm-sub">
                  <div className="adm-sub-head"><b>{a("ud_free")}</b><span className="muted">{planLabel(user.plan).text}</span></div>
                  <Choice label={a("ud_free")} value={free} onChange={setFree}
                    options={[["none", a("ud_free_none")], ["date", a("ud_free_date")], ["lifetime", a("ud_free_life")]]} />
                  <div className="row" style={{ gap: 8 }}>
                    {free === "date" ? <input className="inp" type="date" value={freeDate} onChange={(e) => setFreeDate(e.target.value)} /> : <span className="grow" />}
                    <button className="btn sm" disabled={busy || (free === "date" && !freeDate)} onClick={() => run(async () => {
                      await api.setAccess(user.id, free === "date" ? freeDate : free);
                      const list: AdminUser[] = await api.users(user.email || user.display_name);
                      const fresh = list.find((x) => x.id === user.id);
                      if (fresh) onChanged(fresh);
                      toast(a("ud_saved"));
                    })}>{a("ud_apply")}</button>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          <section className="adm-block">
            <h3>{a("ud_data")}</h3>
            <div className="adm-grid">
              <Field label={t("ui_first_name")}><input className="inp" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} /></Field>
              <Field label={t("ui_last_name")}><input className="inp" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} /></Field>
              <Field label={t("ui_alias")}><input className="inp" value={form.display_name} autoCapitalize="off" onChange={(e) => set("display_name", e.target.value.replace(/[\s@]/g, ""))} /></Field>
              <Field label={t("ui_email")}><input className="inp" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label={t("ui_phone")}><input className="inp" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
              <Field label={t("ui_dob")}><input className="inp" type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} /></Field>
              <Field label={t("ui_country")}>
                <select className="inp" value={form.country} onChange={(e) => set("country", e.target.value)}>
                  {countryOptions(geo?.countries).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </Field>
              <Field label={regionLabel(geo, form.country)}>
                <select className="inp" value={form.province} onChange={(e) => set("province", e.target.value)}>
                  <option value="">—</option>
                  {form.province && !provinces.some((p) => p.value === form.province) ? <option value={form.province}>{form.province}</option> : null}
                  {provinces.map((p) => <option key={p.value} value={p.value}>{p.name}</option>)}
                </select>
              </Field>
              <Field label={a("ud_city")}><input className="inp" value={form.city} onChange={(e) => set("city", e.target.value)} /></Field>
              <Field label={a("ud_password")} hint={isNew ? undefined : a("ud_password_hint")}>
                <input className="inp" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} />
              </Field>
            </div>
            <button id="adm-u-save" className="btn pri" disabled={busy} onClick={saveData}>{isNew ? a("ud_create") : a("ud_save")}</button>
          </section>

          {user && !self ? (
            <section className="adm-block danger">
              <h3>{a("ud_danger")}</h3>
              <p className="muted">{a("ud_delete_hint")}</p>
              {confirmDelete ? (
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="btn dangerfill" disabled={busy} onClick={() => run(async () => { await api.deleteUser(user.id); toast(a("ud_deleted")); onDeleted(user.id); })}>
                    <Icon name="trash" size="sm" />{a("ud_delete_confirm", { name: user.display_name })}
                  </button>
                  <button className="btn" onClick={() => setConfirmDelete(false)}>{a("cancel")}</button>
                </div>
              ) : <button className="btn danger" onClick={() => setConfirmDelete(true)}><Icon name="trash" size="sm" />{a("ud_delete")}</button>}
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Copyable({ icon, text }: { icon: string; text: string }) {
  return (
    <button className="adm-copy" title={a("ud_copy")} onClick={() => navigator.clipboard?.writeText(text).then(() => toast(a("ud_copied"))).catch(() => undefined)}>
      <Icon name={icon} size="sm" /><span>{text}</span><Icon name="copy" size="sm" />
    </button>
  );
}
