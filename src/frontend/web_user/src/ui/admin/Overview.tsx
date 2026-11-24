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
  const max = Math.max(1, ...s.signups.map((d) => d.count));
  const total30 = s.signups.reduce((n, d) => n + d.count, 0);
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
        <Stat icon="users" tone="blue" label={a("ov_people")} value={u.total} sub={a("ov_people_sub", { n: u.new_7d })} onClick={() => goSection("users")} />
        <Stat icon="check2" tone="green" label={a("ov_online")} value={u.online} onClick={() => goSection("users", "online")} />
        <Stat icon="clock" tone="teal" label={a("ov_active")} value={u.active_24h} sub={a("ov_active_sub", { n: u.active_7d })} />
        <Stat icon="chat" tone="violet" label={a("ov_messages")} value={s.activity.messages_24h} sub={a("ov_messages_sub", { n: s.activity.messages_7d })} />
        <Stat icon="compass" tone="teal" label={a("ov_communities")} value={s.activity.communities} onClick={() => goSection("communities")} />
        <Stat icon="calendar" tone="orange" label={a("ov_plans")} value={s.activity.upcoming_plans} />
        <Stat icon="flag" tone={s.reports_open ? "red" : "gray"} alert={s.reports_open > 0} label={a("ov_reports")} value={s.reports_open}
          sub={s.reports_open ? a("ov_reports_go") + " →" : a("ov_reports_none")} onClick={() => goSection("moderation")} />
        <Stat icon="star" tone="pink" label={a("ov_subs")} value={s.plans.gift + s.plans.web + s.plans.play}
          sub={a("ov_subs_sub", s.plans)} onClick={() => goSection("billing")} />
      </div>

      <div className="adm-cols">
        <section className="adm-card">
          <div className="adm-card-head"><b>{a("ov_signups")}</b><span className="muted">{a("ov_signups_total", { n: total30 })}</span></div>
          <div className="adm-bars" role="img" aria-label={a("ov_signups")}>
            {s.signups.map((d) => (
              <span key={d.day} className="adm-bar" title={`${d.day}: ${d.count}`}>
                <i style={{ height: `${Math.max(d.count ? 6 : 2, (d.count / max) * 100)}%` }} className={d.count ? "" : "zero"} />
              </span>
            ))}
          </div>
          <div className="adm-bars-axis"><span>{s.signups[0]?.day.slice(5)}</span><span>{s.signups[s.signups.length - 1]?.day.slice(5)}</span></div>
        </section>

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
