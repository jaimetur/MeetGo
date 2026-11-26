/** MeetGo administration inside the app (administrators only): an overview, then one section per job. */
import React, { useEffect, useState } from "react";
import { t } from "@lang";
import { navigate, queryParam, useRoute } from "../../router";
import { loadAdminPending, useStore } from "../../store";
import { Icon } from "../common";
import { PhoneTop } from "../Board";
import { a } from "./i18n";
import { Overview } from "./Overview";
import { Users } from "./Users";
import { Moderation } from "./Moderation";
import { Communities } from "./Communities";
import { Interests } from "./Interests";
import { Categories } from "./Categories";
import { Business } from "./Business";
import { Settings } from "./Settings";
import { Bots } from "./Bots";
import { Backups } from "./Backups";
import { Logs } from "./Logs";
import { Music } from "./Music";

export type Section = "overview" | "users" | "moderation" | "communities" | "interests" | "categories" | "business" | "settings" | "backups" | "bots" | "logs" | "music";

const SECTIONS: [Section, string, string][] = [
  ["overview", "home", "sec_overview"],
  ["users", "users", "sec_users"],
  ["interests", "smile", "sec_interests"],
  ["communities", "compass", "sec_communities"],
  ["categories", "layers", "sec_categories"],
  ["moderation", "flag", "sec_moderation"],
  ["music", "music", "sec_music"],
  ["business", "chart", "sec_business"],
  ["settings", "sliders", "sec_settings"],
  ["backups", "layers", "sec_backups"],
  ["bots", "shield", "sec_bots"],
  ["logs", "clock", "sec_logs"],
];

/** Moves to a section (and, for users, a filter): the section is in the address, so going back works. */
export function goSection(s: Section, filter?: string) {
  navigate(`/admin?s=${s}${filter ? `&f=${filter}` : ""}`);
}

export function AdminPage() {
  const me = useStore((s) => s.me);
  const route = useRoute();
  const read = (): Section => {
    const raw = queryParam("s");
    // subscriptions and codes are now inside Business: old links go there
    const s = (raw === "billing" || raw === "codes" ? "business" : raw) as Section | null;
    return s && SECTIONS.some(([k]) => k === s) ? s : "overview";
  };
  const [section, setSection] = useState<Section>(read);
  const [, setOpenReports] = useState(0);
  // what waits in each section (kept current by the server's notices)
  const pending = useStore((s) => s.adminPending);
  useEffect(() => { loadAdminPending(); }, [section]);
  const pendingOf = (k: Section) => (k === "moderation" || k === "categories" || k === "communities" ? pending?.[k] || 0 : 0);
  useEffect(() => setSection(read()), [route]);
  // on a phone the tabs scroll sideways: keep the open one in view
  useEffect(() => { document.getElementById(`adm-nav-${section}`)?.scrollIntoView({ block: "nearest", inline: "center" }); }, [section]);

  if (me?.role !== "admin") {
    return (
      <main className="page">
        <div className="empty" style={{ margin: "auto" }}><h3>{t("ui_admin_only")}</h3></div>
      </main>
    );
  }
  const filter = queryParam("f") || undefined;
  return (
    <main className="page adm">
      <PhoneTop title={t("ui_nav_admin")} />
      <div className="adm-shell">
        <nav className="adm-nav" aria-label={t("ui_nav_admin")}>
          {SECTIONS.map(([k, icon, label]) => (
            <button key={k} id={`adm-nav-${k}`} className={section === k ? "on" : ""} aria-current={section === k ? "page" : undefined}
              onClick={() => { if (k !== section) goSection(k); }}>
              <Icon name={icon} size="sm" />
              <span>{a(label)}</span>
              {pendingOf(k) ? <span className="bdg">{pendingOf(k)}</span> : null}
            </button>
          ))}
        </nav>
        <div className="adm-main">
          {section === "overview" ? <Overview onReports={setOpenReports} /> : null}
          {section === "users" ? <Users initialFilter={filter} /> : null}
          {section === "moderation" ? <Moderation onCount={setOpenReports} /> : null}
          {section === "music" ? <Music /> : null}
          {section === "logs" ? <Logs key={filter || ""} initialUser={filter} /> : null}
          {section === "communities" ? <Communities key={filter || ""} initialFilter={filter} /> : null}
          {section === "interests" ? <Interests /> : null}
          {section === "categories" ? <Categories /> : null}
          {section === "business" ? <Business /> : null}
          {section === "settings" ? <Settings /> : null}
          {section === "backups" ? <Backups /> : null}
          {section === "bots" ? <Bots /> : null}
        </div>
      </div>
    </main>
  );
}

/** Title row of a section: name, a short line and the main action. */
export function SectionHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="adm-head">
      <div className="grow">
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children}
    </header>
  );
}
