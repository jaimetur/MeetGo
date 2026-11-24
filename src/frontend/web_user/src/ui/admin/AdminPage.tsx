/** MeetGo administration inside the app (administrators only): an overview, then one section per job. */
import React, { useEffect, useState } from "react";
import { t } from "@lang";
import { navigate, queryParam, useRoute } from "../../router";
import { useStore } from "../../store";
import { Icon } from "../common";
import { PhoneTop } from "../Board";
import { a } from "./i18n";
import { Overview } from "./Overview";
import { Users } from "./Users";
import { Moderation } from "./Moderation";
import { Communities } from "./Communities";
import { Codes } from "./Codes";
import { Billing } from "./Billing";
import { Settings } from "./Settings";
import { Bots } from "./Bots";

export type Section = "overview" | "users" | "moderation" | "communities" | "codes" | "billing" | "settings" | "bots";

const SECTIONS: [Section, string, string][] = [
  ["overview", "home", "sec_overview"],
  ["users", "users", "sec_users"],
  ["moderation", "flag", "sec_moderation"],
  ["communities", "compass", "sec_communities"],
  ["codes", "star", "sec_codes"],
  ["billing", "file", "sec_billing"],
  ["settings", "sliders", "sec_settings"],
  ["bots", "shield", "sec_bots"],
];

/** Moves to a section (and, for users, a filter): the section is in the address, so going back works. */
export function goSection(s: Section, filter?: string) {
  navigate(`/admin?s=${s}${filter ? `&f=${filter}` : ""}`);
}

export function AdminPage() {
  const me = useStore((s) => s.me);
  const route = useRoute();
  const read = (): Section => {
    const s = queryParam("s") as Section | null;
    return s && SECTIONS.some(([k]) => k === s) ? s : "overview";
  };
  const [section, setSection] = useState<Section>(read);
  const [openReports, setOpenReports] = useState(0);
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
              {k === "moderation" && openReports ? <span className="bdg">{openReports}</span> : null}
            </button>
          ))}
        </nav>
        <div className="adm-main">
          {section === "overview" ? <Overview onReports={setOpenReports} /> : null}
          {section === "users" ? <Users initialFilter={filter} /> : null}
          {section === "moderation" ? <Moderation onCount={setOpenReports} /> : null}
          {section === "communities" ? <Communities /> : null}
          {section === "codes" ? <Codes /> : null}
          {section === "billing" ? <Billing /> : null}
          {section === "settings" ? <Settings /> : null}
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
