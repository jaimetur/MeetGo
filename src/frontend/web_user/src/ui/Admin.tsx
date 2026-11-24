import React, { useEffect, useState } from "react";
import { t } from "@lang";
import { actAs, api, backToOwner } from "../api";
import { toast, useStore } from "../store";
import type { UserSummary } from "../types";
import { Icon } from "./common";
import { PhoneTop } from "./Board";
import AdminPanel from "../../../web_admin/App";
import "../../../web_admin/styles.css";

type Tab = "panel" | "bots";

/** MeetGo administration inside the app (administrators only): the whole administration panel — users, settings,
 *  channels, moderation, subscriptions, codes — with the app's own session, and the community bot accounts. */
export function AdminPage() {
  const me = useStore((s) => s.me);
  const [tab, setTab] = useState<Tab>("panel");
  if (me?.role !== "admin") {
    return (
      <main className="page">
        <div className="empty" style={{ margin: "auto" }}><h3>{t("ui_admin_only")}</h3></div>
      </main>
    );
  }
  const tabs: [Tab, string, string][] = [
    ["panel", "sliders", t("ui_admin_panel")],
    ["bots", "shield", t("ui_admin_bots")],
  ];
  return (
    <main className="page adminpage">
      <PhoneTop title={t("ui_nav_admin")} />
      <div className="pagehead">
        <h1 className="ltitle"><Icon name="shield" /> {t("ui_nav_admin")}</h1>
      </div>
      <div className="segtabs" role="tablist">
        {tabs.map(([k, icon, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            <Icon name={icon} size="sm" />{label}
          </button>
        ))}
      </div>
      {tab === "panel" ? <AdminPanel embedded /> : null}
      {tab === "bots" ? <Bots /> : null}
    </main>
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

