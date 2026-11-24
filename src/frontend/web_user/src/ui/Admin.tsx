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
      <span>🤖 {t("ui_acting_as", { name: "@" + me.display_name })}</span>
      <button className="btn sm" onClick={() => { backToOwner(); window.location.assign("/app/admin"); }}>{t("ui_back_to_my_account")}</button>
    </div>
  );
}
