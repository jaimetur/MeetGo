/** "MeetGo has been updated": each build carries an id, also published at /version.json. When the server answers with
 * another one (a new version was deployed), a notice offers to reload the page and apply the latest changes. It does
 * not reload by itself: what I am writing could go. Checked every minute while visible and when the app comes back. */
import React, { useEffect, useState } from "react";
import { t } from "@lang";
import { Icon } from "./common";

const POLL_MS = 60_000;

export function UpdateNotice() {
  const [build, setBuild] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState("");
  useEffect(() => {
    if (!__BUILD_ID__ || __BUILD_ID__ === "dev") return;
    let stop = false;
    const check = async () => {
      if (stop || document.hidden) return;
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const b = String((await r.json()).build || "");
        if (b && b !== __BUILD_ID__ && !stop) setBuild(b);
      } catch {
        /* offline: next time */
      }
    };
    const onWake = () => { if (!document.hidden) void check(); };
    void check();
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
    };
  }, []);
  if (!build || build === dismissed) return null;
  return (
    <div className="updnote" role="alert">
      <div className="grow">
        <b>{t("ui_update_title")}</b>
        <span>{t("ui_update_body")}</span>
      </div>
      <button type="button" className="btn pri sm" onClick={() => window.location.reload()}>{t("ui_update_reload")}</button>
      <button type="button" className="iconbtn" onClick={() => setDismissed(build)} title={t("ui_update_later")} aria-label={t("ui_update_later")}><Icon name="x" size="sm" /></button>
    </div>
  );
}
