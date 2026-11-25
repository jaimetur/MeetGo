/** The administration at a glance: people, activity, what needs a look, sign-ups and where people are. */
import React, { useEffect, useState } from "react";
import { api, type AdminStats } from "../../../../web_admin/api";
import { Icon } from "../common";
import { SectionHead, goSection } from "./AdminPage";
import { a } from "./i18n";
import { Stat } from "./kit";

export function Overview({ onReports }: { onReports: (n: number) => void }) {
  const [s, setS] = useState<AdminStats | null>(null);
  const [error, setError] = useState("");
  const load = () => api.stats().then((r) => { setS(r); onReports(r.reports_open); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (!s) return <div className="adm-loading">{error || a("loading")}</div>;
  const u = s.users;
  const maxProv = Math.max(1, ...s.provinces.map((p) => p.count));
  const attention: [string, string, number, () => void][] = [
    ["flag", a("ov_reports") + `: ${s.reports_open}`, s.reports_open, () => goSection("moderation")],
    ["info", a("ov_unverified", { n: u.unverified }), u.unverified, () => goSection("users", "unverified")],
    ["shield", a("ov_banned", { n: u.banned }), u.banned, () => goSection("users", "banned")],
  ];
  const pending = attention.filter(([, , n]) => n > 0);

  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_overview")}>
        <button className="btn sm" onClick={load}>{a("refresh")}</button>
      </SectionHead>

      <div className="adm-stats">
        <Stat icon="check2" tone="green" label={a("ov_online")} value={u.online} onClick={() => goSection("users", "online")} />
        <Stat icon="clock" tone="teal" label={a("ov_active")} value={u.active_24h} sub={a("ov_active_sub", { n: u.active_7d })} />
        <Stat icon="chat" tone="violet" label={a("ov_messages")} value={s.activity.messages_24h} sub={a("ov_messages_sub", { n: s.activity.messages_7d })} />
        <Stat icon="compass" tone="teal" label={a("ov_communities")} value={s.activity.communities} onClick={() => goSection("communities")} />
        <Stat icon="calendar" tone="orange" label={a("ov_plans")} value={s.activity.upcoming_plans} />
        <Stat icon="flag" tone={s.reports_open ? "red" : "gray"} alert={s.reports_open > 0} label={a("ov_reports")} value={s.reports_open}
          sub={s.reports_open ? a("ov_reports_go") + " →" : a("ov_reports_none")} onClick={() => goSection("moderation")} />
      </div>

      <div className="adm-cols">

        <section className="adm-card">
          <div className="adm-card-head"><b>{a("ov_attention")}</b></div>
          {pending.length ? (
            <div className="adm-todo">
              {pending.map(([icon, text, , go]) => (
                <button key={text} onClick={go}><Icon name={icon} size="sm" /><span className="grow">{text}</span><span aria-hidden="true">›</span></button>
              ))}
            </div>
          ) : <div className="adm-allgood"><Icon name="check2" />{a("ov_all_good")}</div>}
          <div className="adm-card-head" style={{ marginTop: 14 }}><b>{a("ov_provinces")}</b></div>
          <div className="adm-hbars">
            {s.provinces.map((p) => (
              <div key={p.province} className="adm-hbar">
                <span className="lbl">{p.province}</span>
                <span className="track"><i style={{ width: `${(p.count / maxProv) * 100}%` }} /></span>
                <b>{p.count}</b>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
