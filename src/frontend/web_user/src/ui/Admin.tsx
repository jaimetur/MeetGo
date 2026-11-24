import React from "react";
import { t } from "@lang";
import { backToOwner } from "../api";
import { useStore } from "../store";

/** MeetGo administration: ui/admin/ (overview, users, moderation, communities, codes, subscriptions, settings, bots). */
export { AdminPage } from "./admin/AdminPage";

/** While an administrator uses a bot account: who they are and the way back. */
export function ActingAsBar() {
  const me = useStore((s) => s.me);
  if (!me?.bot_role) return null;
  return (
    <div className="actingbar" role="status">
      {/* on a phone only the bot's name: the whole sentence would push it out */}
      <span><span className="act-full">🤖 {t("ui_acting_as", { name: "@" + me.display_name })}</span><span className="act-short">🤖 <b>@{me.display_name}</b></span></span>
      <button className="btn sm" onClick={() => { backToOwner(); window.location.assign("/app/admin"); }}>{t("ui_back_to_my_account")}</button>
    </div>
  );
}
