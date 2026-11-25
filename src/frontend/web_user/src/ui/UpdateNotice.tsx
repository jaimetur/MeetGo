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
  // it sits at the bottom, above whatever is there (the composer in a chat, the tab bar on phones), covering nothing
  const [bottom, setBottom] = useState<number | null>(null);
  const showing = !!build && build !== dismissed;
  useEffect(() => {
    if (!showing) return;
    const place = () => {
      let top = window.innerHeight;
      for (const sel of [".composer", ".mnav"]) {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
          const r = el.getBoundingClientRect();
          if (r.height && r.bottom > window.innerHeight - 4 - 200 && r.top < top && getComputedStyle(el).display !== "none") top = r.top;
        }
      }
      setBottom(top < window.innerHeight ? Math.round(window.innerHeight - top + 10) : null);
    };
    place();
    const timer = window.setInterval(place, 700);  // the screen changes (another page, the keyboard)
    window.addEventListener("resize", place);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", place); };
  }, [showing]);
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
  if (!showing) return null;
  return (
    <div className="updnote" role="alert" style={bottom != null ? { bottom } : undefined}>
      <div className="grow">
        <b>{t("ui_update_title")}</b>
        <span>{t("ui_update_body")}</span>
      </div>
      <button type="button" className="btn pri sm" onClick={() => window.location.reload()}>{t("ui_update_reload")}</button>
      <button type="button" className="iconbtn" onClick={() => setDismissed(build)} title={t("ui_update_later")} aria-label={t("ui_update_later")}><Icon name="x" size="sm" /></button>
    </div>
  );
}
