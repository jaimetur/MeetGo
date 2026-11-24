/** The community bots (bot-admin, bot-moderator) and the moderation bot's state; an administrator can act as them. */
import React, { useEffect, useState } from "react";
import { t } from "@lang";
import { actAs, api } from "../../api";
import { toast } from "../../store";
import type { UserSummary } from "../../types";
import { Avatar, Icon } from "../common";
import { SectionHead, goSection } from "./AdminPage";
import { a } from "./i18n";
import { Badge } from "./kit";

export function Bots() {
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
    <div className="adm-sec">
      <SectionHead title={a("sec_bots")} sub={a("bo_hint")} />
      {automod ? (
        <div className={"adm-state" + (automod.enabled ? " ok" : "")}>
          <span className="adm-state-ic"><Icon name="shield" /></span>
          <span className="grow"><b>{automod.enabled ? t("ui_admin_automod_on") : t("ui_admin_automod_off")}</b>{automod.enabled ? <small>{automod.model}</small> : null}</span>
          {automod.enabled ? null : <button className="btn sm" onClick={() => goSection("settings")}>{a("bi_edit")}</button>}
          <span className="adm-state-dot" aria-hidden="true">{automod.enabled ? "✓" : "!"}</span>
        </div>
      ) : null}
      <div className="adm-list">
        {(bots || []).map((b) => (
          <div key={b.id} className="adm-card adm-bot">
            <Avatar user={b} size={44} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="adm-urow-name"><b>@{b.display_name}</b><Badge tone="violet">{b.bot_role === "admin" ? a("b_admin") : a("sec_moderation")}</Badge></div>
              <div className="muted adm-bot-hint">{t(b.bot_role === "admin" ? "ui_bot_admin_hint" : "ui_bot_moderator_hint")}</div>
            </div>
            <button className="btn pri sm" onClick={() => enter(b)}>{a("bo_enter", { name: "@" + b.display_name })}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
