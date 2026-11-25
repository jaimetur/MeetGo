/** Administration → Business: a dashboard of users, subscriptions, revenue, downloads, Google Play and health (each
 * figure with its source and when it was read), and below it every setting of payments, subscriptions and API keys. */
import React, { useEffect, useState } from "react";
import { api, type Business as Data, type Point, type Source } from "../../../../web_admin/api";
import { Icon } from "../common";
import { Billing, TestButton } from "./Billing";
import { ClaudeSettings } from "./Claude";
import { Codes } from "./Codes";
import { SectionHead, goSection } from "./AdminPage";
import { a, fmtDateTime } from "./i18n";
import { Choice, Fold } from "./kit";

type Period = "7d" | "30d" | "12m" | "all";
const SOURCES: Record<string, string> = { meetgo: "MeetGo", stripe: "Stripe", play_api: "Google Play", play_reports: "bz_src_play_reports", server: "bz_src_server" };

const euros = (n: number | undefined | null, currency = "EUR") => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "EUR", maximumFractionDigits: 2 }).format(n || 0);
  } catch {
    return `${(n || 0).toFixed(2)} ${currency}`;
  }
};
const TRACKS = ["production", "beta", "alpha", "internal"];
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)} %`);
const gb = (bytes: number) => `${(bytes / 1e9).toFixed(bytes > 1e11 ? 0 : 1)} GB`;

function ago(iso?: string | null) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return a("bz_ago_now");
  if (s < 3600) return a("bz_ago_min", { n: Math.round(s / 60) });
  if (s < 86400 * 2) return a("bz_ago_h", { n: Math.round(s / 3600) });
  return a("bz_ago_d", { n: Math.round(s / 86400) });
}

/** Where a block's figures come from and when, or why there are none (with the way to its setting). */
function From({ src, until, note, configure }: { src: Source; until?: string | null; note?: string; configure?: string }) {
  const name = SOURCES[src.source] || src.source;
  const label = name.startsWith("bz_") ? a(name) : name;
  if (src.state === "unconfigured") {
    return (
      <div className="bz-from off">
        <Icon name="info" size="sm" /><span className="grow">{a("bz_unconfigured", { source: label })}</span>
        {configure ? <button type="button" className="linkbtn" onClick={() => openFold(configure)}>{a("bz_configure")} ›</button> : null}
      </div>
    );
  }
  if (src.state === "error") {
    return (
      <div className="bz-from err">
        <Icon name="info" size="sm" /><span className="grow">{a("bz_error", { source: label, error: src.error || "" })}</span>
        {configure ? <button type="button" className="linkbtn" onClick={() => openFold(configure)}>{a("bz_configure")} ›</button> : null}
      </div>
    );
  }
  return (
    <div className="bz-from">
      <span className="grow">{label} · {ago(src.updated_at)}{until ? ` · ${a("bz_data_until", { day: until })}` : ""}</span>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function openFold(id: string) {
  const el = document.getElementById(id) as HTMLDetailsElement | null;
  if (!el) return;
  el.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Bars({ points, label, money }: { points: Point[]; label: string; money?: boolean }) {
  if (!points.length) return null;
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <>
      <div className="adm-bars" role="img" aria-label={label}>
        {points.map((p) => (
          <span key={p.label} className="adm-bar" title={`${p.label}: ${money ? euros(p.value) : p.value}`}>
            <i style={{ height: `${Math.max(p.value ? 6 : 2, (p.value / max) * 100)}%` }} className={p.value ? "" : "zero"} />
          </span>
        ))}
      </div>
      <div className="adm-bars-axis"><span>{points[0].label}</span><span>{points[points.length - 1].label}</span></div>
    </>
  );
}

function Num({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="bz-num"><small>{label}</small><b>{value}</b>{sub ? <span>{sub}</span> : null}</div>;
}

function Card({ icon, title, children, wide }: { icon: string; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={"adm-card bz-card" + (wide ? " wide" : "")}>
      <div className="adm-card-head"><b><Icon name={icon} size="sm" /> {title}</b></div>
      {children}
    </section>
  );
}

export function Business() {
  const [period, setPeriod] = useState<Period>(() => {
    try {
      const v = localStorage.getItem("adm.business.period");
      return v === "7d" || v === "30d" || v === "12m" || v === "all" ? v : "30d";
    } catch {
      return "30d";
    }
  });
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = (refresh = false) => {
    setBusy(true);
    api.business(period, refresh).then((r) => { setD(r); setError(""); }).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
    try {
      localStorage.setItem("adm.business.period", period);
    } catch {
      /* per device */
    }
  }, [period]);

  const periodLabel = a(`bz_p_${period}`);
  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_business")} sub={a("bz_lead")}>
        <button className="btn sm" disabled={busy} onClick={() => load(true)}>{a("refresh")}</button>
      </SectionHead>
      <div className="bz-period">
        <Choice label={a("bz_period")} value={period} onChange={setPeriod}
          options={[["7d", a("bz_p_7d")], ["30d", a("bz_p_30d")], ["12m", a("bz_p_12m")], ["all", a("bz_p_all")]]} />
      </div>

      {!d ? <div className="adm-loading">{error || a("loading")}</div> : <Dashboard d={d} periodLabel={periodLabel} />}

      <h2 className="bz-h2" id="bz-config">{a("bz_config")}</h2>
      <p className="muted adm-note">{a("bz_config_lead")}</p>
      <Billing embedded />
      <Fold id="bz-cfg-claude" icon="chat" title={a("bz_claude")} summary={a("bz_claude_hint")}>
        <ClaudeSettings />
      </Fold>
      <Fold id="bz-cfg-smtp" icon="send" title={a("bz_smtp")} summary={a("bz_smtp_hint")}>
        <div className="row">
          <TestButton source="smtp" />
          <button type="button" className="btn sm" onClick={() => goSection("settings")}><Icon name="sliders" size="sm" />{a("bz_smtp_go")}</button>
        </div>
      </Fold>
      <Codes />
    </div>
  );
}

function Dashboard({ d, periodLabel }: { d: Data; periodLabel: string }) {
  const u = d.users, s = d.subscriptions, r = d.revenue, dl = d.downloads, h = d.health;
  const st = r.stripe;
  return (
    <div className="bz-grid">
      <Card icon="users" title={a("bz_users")}>
        <div className="bz-nums">
          <Num label={a("bz_accounts")} value={u.total} />
          <Num label={a("bz_new", { period: periodLabel })} value={u.new} />
          <Num label={a("bz_active_7d")} value={u.active_7d} />
          <Num label={a("bz_active_30d")} value={u.active_30d} />
        </div>
        <Bars points={u.series} label={a("bz_signups")} />
        <From src={u} />
      </Card>

      <Card icon="star" title={a("bz_subs")}>
        {!s.enabled ? <div className="bz-from off"><Icon name="info" size="sm" /><span className="grow">{a("bz_subs_off")}</span>
          <button type="button" className="linkbtn" onClick={() => openFold("bz-cfg-subs")}>{a("bz_configure")} ›</button></div> : null}
        <div className="bz-nums">
          <Num label={a("bz_paid")} value={s.paid} sub={a("bz_plans", { m: s.by_plan.monthly, y: s.by_plan.yearly })} />
          <Num label={a("bz_trialing")} value={s.trialing} sub={a("bz_trial_days", { n: s.trial_days })} />
          <Num label={a("bz_ended")} value={s.ended} />
          <Num label={a("bz_read_only")} value={s.read_only} />
          <Num label={a("bz_channels")} value={`${s.by_channel.web} · ${s.by_channel.play}`} sub={a("bz_channels_sub")} />
          <Num label={a("bz_gifts")} value={s.gifts.total} sub={a("bz_gifts_sub", { promo: s.gifts.promo, admin: s.gifts.admin, free: s.free_legacy })} />
        </div>
        {s.promos.length ? (
          <div className="bz-list">
            {s.promos.map((p) => (
              <div key={p.code}><b className="mono">{p.code}</b><span className="grow">{p.public ? a("bz_launch") : ""}</span>
                <span>{p.max == null ? a("bz_used", { n: p.used }) : a("bz_used_of", { n: p.used, max: p.max, left: p.left ?? 0 })}</span></div>
            ))}
          </div>
        ) : null}
        <From src={s} />
      </Card>

      <Card icon="file" title={a("bz_revenue")} wide>
        <div className="bz-nums">
          <Num label={a("bz_mrr")} value={euros(r.mrr.total)} sub={a("bz_mrr_sub", { web: euros(r.mrr.web), play: euros(r.mrr.play) })} />
          {st.state === "ok" ? (
            <>
              <Num label={a("bz_collected", { period: periodLabel })} value={euros(st.collected)} sub={a("bz_refunded", { n: euros(st.refunded) })} />
              <Num label={a("bz_conversion")} value={pct(st.conversion)} sub={a("bz_conversion_sub", { n: st.converted ?? 0, of: st.trials_ended ?? 0 })} />
              <Num label={a("bz_cancelled", { period: periodLabel })} value={st.cancelled ?? 0} />
            </>
          ) : null}
          {r.play.state === "ok" ? (
            <Num label={a("bz_play_earnings", { period: periodLabel })} value={euros(r.play.period, r.play.currency)} />
          ) : null}
        </div>
        <From src={r.mrr} note={a("bz_mrr_note")} />
        {st.state === "ok" ? <Bars points={r.stripe_series} label={a("bz_revenue")} money /> : null}
        <From src={st} configure="bz-cfg-stripe" />
        <From src={r.play} until={r.play.until} note={a("bz_play_delay")} configure="bz-cfg-play" />
      </Card>

      <Card icon="download" title={a("bz_downloads")}>
        <div className="bz-nums">
          <Num label={a("bz_apk")} value={dl.apk.period} sub={a("bz_apk_total", { n: dl.apk.total })} />
          {dl.play.state === "ok" ? <Num label={a("bz_play_installs")} value={dl.play.period ?? 0} sub={a("bz_apk_total", { n: dl.play.total ?? 0 })} /> : null}
        </div>
        <Bars points={dl.apk.series} label={a("bz_apk")} />
        <From src={dl.apk} note={dl.apk.since ? a("bz_apk_since", { day: dl.apk.since }) : a("bz_apk_new")} />
        <From src={dl.play} until={dl.play.until} note={a("bz_installs_delay")} configure="bz-cfg-play" />
      </Card>

      <Card icon="gamepad" title="Google Play">
        {d.play.tracks.state === "ok" ? (
          <div className="bz-list">
            {(d.play.tracks.items || []).map((t) => (
              <div key={t.track}><b>{TRACKS.includes(t.track) ? a(`bz_track_${t.track}`) : t.track}</b><span className="grow" />
                <span>{t.name || "—"}{t.codes.length ? ` (${t.codes.join(", ")})` : ""}</span></div>
            ))}
          </div>
        ) : null}
        <small className="muted">{d.play.package}</small>
        <From src={d.play.tracks} configure="bz-cfg-play" />
      </Card>

      <Card icon="shield" title={a("bz_health")}>
        <div className="bz-list">
          <div><b>{a("bz_backup")}</b><span className="grow" />
            <span className={h.backup.problem ? "adm-red" : ""}>{h.backup.last_success ? fmtDateTime(h.backup.last_success) : a("bz_never")}</span></div>
          <div><b>{a("bz_mail")}</b><span className="grow" />
            <span className={h.mail.ok === false ? "adm-red" : h.mail.ok ? "adm-green" : ""}>
              {!h.mail.configured ? a("bz_mail_off") : h.mail.ok == null ? a("bz_mail_unknown") : h.mail.ok ? a("bz_mail_ok", { when: ago(h.mail.at) }) : a("bz_mail_fail", { error: h.mail.error || "" })}
            </span></div>
          {h.disk ? <div><b>{a("bz_disk")}</b><span className="grow" /><span className={h.disk.low ? "adm-red" : ""}>{a("bz_disk_free", { free: gb(h.disk.free), total: gb(h.disk.total) })}</span></div> : null}
        </div>
        <button type="button" className="linkbtn" onClick={() => goSection("backups")}>{a("sec_backups")} ›</button>
        <From src={h} />
      </Card>
    </div>
  );
}
