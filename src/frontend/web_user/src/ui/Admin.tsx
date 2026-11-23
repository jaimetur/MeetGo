import React, { useCallback, useEffect, useState } from "react";
import { t } from "@lang";
import { actAs, api, backToOwner } from "../api";
import { chatPath, navigate } from "../router";
import { toast, useStore } from "../store";
import type { UserSummary } from "../types";
import { Avatar, Icon } from "./common";
import { PhoneTop } from "./Board";

type Tab = "reports" | "users" | "bots";

/** MeetGo administration inside the app: moderation queue, people and the community bots (administrators only). */
export function AdminPage() {
  const me = useStore((s) => s.me);
  const [tab, setTab] = useState<Tab>("reports");
  if (me?.role !== "admin") {
    return (
      <main className="page">
        <div className="empty" style={{ margin: "auto" }}><h3>{t("ui_admin_only")}</h3></div>
      </main>
    );
  }
  const tabs: [Tab, string, string][] = [
    ["reports", "flag", t("ui_admin_reports")],
    ["users", "users", t("ui_admin_users")],
    ["bots", "shield", t("ui_admin_bots")],
  ];
  return (
    <main className="page adminpage">
      <PhoneTop title={t("ui_nav_admin")} />
      <div className="pagehead">
        <h1 className="ltitle"><Icon name="shield" /> {t("ui_nav_admin")}</h1>
        <a className="btn sm" href="https://admin.meetgo.app/" target="_blank" rel="noopener noreferrer">{t("ui_admin_panel")}</a>
      </div>
      <div className="segtabs" role="tablist">
        {tabs.map(([k, icon, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            <Icon name={icon} size="sm" />{label}
          </button>
        ))}
      </div>
      {tab === "reports" ? <Reports /> : null}
      {tab === "users" ? <Users /> : null}
      {tab === "bots" ? <Bots /> : null}
    </main>
  );
}

function Reports() {
  const [list, setList] = useState<any[] | null>(null);
  const load = useCallback(() => {
    api.adminReports().then(setList).catch((e) => { toast(e.message, "error"); setList([]); });
  }, []);
  useEffect(load, [load]);
  async function resolve(id: number, status: "dismissed" | "actioned", del: boolean) {
    try {
      await api.adminResolveReport(id, status, del);
      toast(t("ui_done"));
      load();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  if (list === null) return <div className="muted" style={{ padding: 12 }}>{t("ui_loading")}</div>;
  if (!list.length) return <div className="box muted">{t("ui_admin_no_reports")}</div>;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {list.map((r) => {
        const m = r.message;
        const open = () => r.post ? navigate(`/p/${r.post.id}`) : m ? navigate(chatPath(m.conversation_id, { around: m.id })) : undefined;
        return (
          <section key={r.id} className="box stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="ktag k-notice">{r.reason}</span>
              <span className="muted grow" style={{ fontSize: 12.5 }}>{t("ui_admin_reported_by", { name: r.reporter?.display_name || "—" })}</span>
            </div>
            {m ? (
              <div className="reportbody">
                <b>{m.sender?.display_name || "—"}</b>
                <div>{m.deleted ? m.original_body || "" : m.body}</div>
              </div>
            ) : null}
            {r.details ? <div className="muted" style={{ fontSize: 13 }}>{r.details}</div> : null}
            <div className="btns">
              <button className="btn sm" onClick={open}>{t("ui_admin_open")}</button>
              <button className="btn sm danger" onClick={() => resolve(r.id, "actioned", true)}>{t("ui_admin_delete_content")}</button>
              <button className="btn sm" onClick={() => resolve(r.id, "dismissed", false)}>{t("ui_admin_dismiss")}</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Users() {
  const me = useStore((s) => s.me);
  const [q, setQ] = useState("");
  const [list, setList] = useState<any[] | null>(null);
  const load = useCallback(() => {
    api.adminUsers(q.trim()).then((u) => setList(u.filter((x) => !x.bot_role))).catch(() => setList([]));
  }, [q]);
  useEffect(() => {
    const id = window.setTimeout(load, q ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);
  async function patch(u: any, change: Record<string, unknown>) {
    try {
      await api.adminUpdateUser(u.id, change);
      toast(t("ui_done"));
      load();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  return (
    <section className="box">
      <div className="search" style={{ marginBottom: 6 }}>
        <Icon name="search" size="sm" />
        <input id="admin-user-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_admin_search_users")} />
      </div>
      {list === null ? <div className="muted" style={{ padding: 8 }}>{t("ui_loading")}</div> : null}
      <div className="plist">
        {(list || []).map((u) => (
          <div key={u.id} className="item adminuser">
            <Avatar user={u} size={36} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600 }}>{u.display_name}</span>
                {u.role === "admin" ? <span className="role">{t("ui_admin_role_admin")}</span> : null}
                {u.is_banned ? <span className="role bad">{t("ui_admin_blocked")}</span> : null}
              </div>
              <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{[u.email, u.province].filter(Boolean).join(" · ")}</div>
            </div>
            {u.id !== me?.id ? (
              <div className="btns">
                {u.role === "admin"
                  ? <button className="btn sm" onClick={() => window.confirm(t("ui_admin_remove_admin") + ": " + u.display_name) && patch(u, { role: "user" })}>{t("ui_admin_remove_admin")}</button>
                  : <button className="btn sm" onClick={() => window.confirm(t("ui_admin_make_admin") + ": " + u.display_name) && patch(u, { role: "admin" })}>{t("ui_admin_make_admin")}</button>}
                {u.is_banned
                  ? <button className="btn sm" onClick={() => patch(u, { is_banned: false })}>{t("ui_admin_unblock")}</button>
                  : <button className="btn sm danger" onClick={() => window.confirm(t("ui_admin_block") + ": " + u.display_name) && patch(u, { is_banned: true })}>{t("ui_admin_block")}</button>}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Bots() {
  const [bots, setBots] = useState<(UserSummary & { bot_role: string })[] | null>(null);
  const [automod, setAutomod] = useState<{ enabled: boolean; model: string } | null>(null);
  useEffect(() => {
    api.adminBots().then(setBots).catch(() => setBots([]));
    api.adminAutomod().then(setAutomod).catch(() => undefined);
  }, []);
  async function enter(bot: UserSummary) {
    try {
      const { access_token } = await api.adminBotSession(bot.id);
      actAs(access_token);
      window.location.assign("/app/communities");
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      <section className="box stack" style={{ gap: 6 }}>
        <p className="muted" style={{ margin: 0 }}>{t("ui_admin_bots_hint")}</p>
        {automod ? <div className={"automod " + (automod.enabled ? "on" : "off")}>{automod.enabled ? t("ui_admin_automod_on") : t("ui_admin_automod_off")}</div> : null}
      </section>
      {(bots || []).map((b) => (
        <section key={b.id} className="box row" style={{ gap: 12 }}>
          <span className="botav" aria-hidden="true">🤖</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>@{b.display_name}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>{t(b.bot_role === "admin" ? "ui_bot_admin_hint" : "ui_bot_moderator_hint")}</div>
          </div>
          <button className="btn pri sm" onClick={() => enter(b)}>{t("ui_admin_enter_as", { name: "@" + b.display_name })}</button>
        </section>
      ))}
    </div>
  );
}

/** While an administrator uses a bot account: who they are and the way back. */
export function ActingAsBar() {
  const me = useStore((s) => s.me);
  if (!me?.bot_role) return null;
  return (
    <div className="actingbar" role="status">
      <span>🤖 {t("ui_acting_as", { name: "@" + me.display_name })}</span>
      <button className="btn sm" onClick={() => { backToOwner(); window.location.assign("/app/admin"); }}>{t("ui_back_to_my_account")}</button>
    </div>
  );
}

