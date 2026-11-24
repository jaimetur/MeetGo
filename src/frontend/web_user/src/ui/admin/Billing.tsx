/** Subscriptions: what is set up at a glance, and each service's settings folded underneath. */
import React, { useEffect, useState } from "react";
import { api, type BillingInfo, type BillingUpdate } from "../../../../web_admin/api";
import { t2 } from "../../../../web_admin/strings";
import { toast } from "../../store";
import { Icon } from "../common";
import { SectionHead } from "./AdminPage";
import { a } from "./i18n";
import { Field, Fold, Switch } from "./kit";

const validJson = (text: string) => {
  try {
    const v = JSON.parse(text);
    return !!v && typeof v === "object" && !Array.isArray(v);
  } catch {
    return false;
  }
};

function State({ icon, label, ok, okText, offText }: { icon: string; label: string; ok: boolean; okText?: string; offText?: string }) {
  return (
    <div className={"adm-state" + (ok ? " ok" : "")}>
      <span className="adm-state-ic"><Icon name={icon} /></span>
      <span className="grow"><b>{label}</b><small>{ok ? okText || t2("configured") : offText || t2("not_configured")}</small></span>
      <span className="adm-state-dot" aria-hidden="true">{ok ? "✓" : "!"}</span>
    </div>
  );
}

export function Billing() {
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [general, setGeneral] = useState({ enabled: false, trial_days: "0" });
  const [stripe, setStripe] = useState({ secret: "", webhook: "" });
  const [play, setPlay] = useState({ package: "", product: "", store_url: "", service_account: "" });
  const [fcm, setFcm] = useState("");
  const [busy, setBusy] = useState(false);

  const fill = (b: BillingInfo) => {
    setInfo(b);
    setGeneral({ enabled: !!b.enabled, trial_days: String(b.trial_days ?? 0) });
    setPlay((p) => ({ ...p, package: b.play?.package || "", product: b.play?.product || "", store_url: b.play?.store_url || "", service_account: "" }));
  };
  useEffect(() => { api.billing().then(fill).catch((e) => toast(e.message, "error")); }, []);

  async function save(payload: BillingUpdate, after?: () => void) {
    setBusy(true);
    try {
      fill(await api.saveBilling(payload));
      after?.();
      toast(t2("saved"));
    } catch (e: any) {
      toast(e?.message || a("save_error"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!info) return <div className="adm-loading">{a("loading")}</div>;
  const prices = Object.entries(info.stripe?.prices || {});
  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_billing")} sub={t2("bill_counts", { gift: info.counts?.gift ?? 0, web: info.counts?.web ?? 0, play: info.counts?.play ?? 0 })} />
      <div className="adm-states">
        <State icon="star" label={a("bi_charging")} ok={info.enabled} okText={a("bi_on")} offText={a("bi_off")} />
        <State icon="link" label={a("bi_stripe")} ok={!!info.stripe?.configured && !!info.stripe?.webhook_configured} />
        <State icon="gamepad" label={a("bi_play")} ok={!!info.play?.configured} />
        <State icon="bell" label={a("bi_push")} ok={!!info.fcm?.configured} />
      </div>

      <Fold icon="sliders" title={t2("bill_general")} summary={t2("bill_general_hint")} open>
        <Switch id="adm-bill-on" label={t2("bill_enabled")} on={general.enabled} onChange={(v) => setGeneral({ ...general, enabled: v })} />
        <Field label={t2("bill_trial_days")}><input className="inp" type="number" min={0} max={90} value={general.trial_days} onChange={(e) => setGeneral({ ...general, trial_days: e.target.value })} /></Field>
        <button className="btn pri" disabled={busy} onClick={() => save({ enabled: general.enabled, trial_days: Math.max(0, Math.min(90, Number(general.trial_days) || 0)) })}>{t2("save")}</button>
      </Fold>

      <Fold icon="link" title={t2("bill_stripe")} summary={t2("bill_stripe_hint")}>
        <Field label={`${t2("bill_stripe_secret")} · ${info.stripe?.configured ? t2("configured") : t2("not_configured")}`}>
          <input className="inp" type="password" autoComplete="off" placeholder={info.stripe?.configured ? t2("bill_secret_placeholder") : "sk_live_…"} value={stripe.secret} onChange={(e) => setStripe({ ...stripe, secret: e.target.value })} />
        </Field>
        <Field label={`${t2("bill_stripe_webhook")} · ${info.stripe?.webhook_configured ? t2("configured") : t2("not_configured")}`}>
          <input className="inp" type="password" autoComplete="off" placeholder={info.stripe?.webhook_configured ? t2("bill_secret_placeholder") : "whsec_…"} value={stripe.webhook} onChange={(e) => setStripe({ ...stripe, webhook: e.target.value })} />
        </Field>
        <Field label={t2("bill_webhook_url")}>
          <div className="row" style={{ gap: 8 }}>
            <input className="inp" readOnly value={info.stripe?.webhook_url || ""} onFocus={(e) => e.target.select()} />
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(info.stripe?.webhook_url || "").then(() => toast(a("ud_copied"))).catch(() => undefined)}><Icon name="copy" size="sm" /></button>
          </div>
        </Field>
        <p className="muted adm-note">{t2("bill_prices")}: {prices.length ? prices.map(([k, id]) => `${k === "monthly" ? t2("bill_price_monthly") : k === "yearly" ? t2("bill_price_yearly") : k}: ${id}`).join(" · ") : t2("bill_prices_none")}</p>
        <button className="btn pri" disabled={busy} onClick={() => {
          const p: { secret?: string; webhook?: string } = {};
          if (stripe.secret.trim()) p.secret = stripe.secret.trim();
          if (stripe.webhook.trim()) p.webhook = stripe.webhook.trim();
          if (!p.secret && !p.webhook) return toast(t2("bill_nothing_to_save"), "error");
          save({ stripe: p }, () => setStripe({ secret: "", webhook: "" }));
        }}>{t2("save")}</button>
      </Fold>

      <Fold icon="gamepad" title={t2("bill_play")} summary={t2("bill_play_hint")}>
        <div className="adm-grid">
          <Field label={t2("bill_play_package")}><input className="inp" placeholder="app.meetgo.android" value={play.package} onChange={(e) => setPlay({ ...play, package: e.target.value })} /></Field>
          <Field label={t2("bill_play_product")}><input className="inp" placeholder="meetgo" value={play.product} onChange={(e) => setPlay({ ...play, product: e.target.value })} /></Field>
        </div>
        <Field label={t2("bill_play_store_url")}><input className="inp" value={play.store_url} onChange={(e) => setPlay({ ...play, store_url: e.target.value })} /></Field>
        <Field label={`${t2("bill_service_account")} · ${info.play?.configured ? t2("configured") : t2("not_configured")}`}>
          <textarea className="inp mono" rows={4} spellCheck={false} placeholder={t2("bill_sa_placeholder")} value={play.service_account} onChange={(e) => setPlay({ ...play, service_account: e.target.value })} />
        </Field>
        <button className="btn pri" disabled={busy} onClick={() => {
          const sa = play.service_account.trim();
          if (sa && !validJson(sa)) return toast(t2("bill_invalid_json"), "error");
          save({ play: { package: play.package.trim(), product: play.product.trim(), store_url: play.store_url.trim(), ...(sa ? { service_account: sa } : {}) } });
        }}>{t2("save")}</button>
      </Fold>

      <Fold icon="bell" title={t2("bill_fcm")} summary={info.fcm?.project_id ? t2("bill_fcm_project", { id: info.fcm.project_id }) : t2("bill_fcm_hint")}>
        <Field label={`${t2("bill_service_account")} · ${info.fcm?.configured ? t2("configured") : t2("not_configured")}`}>
          <textarea className="inp mono" rows={4} spellCheck={false} placeholder={t2("bill_sa_placeholder")} value={fcm} onChange={(e) => setFcm(e.target.value)} />
        </Field>
        <button className="btn pri" disabled={busy} onClick={() => {
          const sa = fcm.trim();
          if (!sa) return toast(t2("bill_nothing_to_save"), "error");
          if (!validJson(sa)) return toast(t2("bill_invalid_json"), "error");
          save({ fcm: { service_account: sa } }, () => setFcm(""));
        }}>{t2("save")}</button>
      </Fold>
    </div>
  );
}
