import { useEffect, useState } from "react";
import { api, type BillingInfo, type BillingUpdate } from "./api";
import { t2 } from "./strings";

type Block = "general" | "stripe" | "play" | "fcm";

/** Service accounts go to the backend as JSON text; check it first to show a clear message. */
function validJson(text: string) {
  try {
    const v = JSON.parse(text);
    return !!v && typeof v === "object" && !Array.isArray(v);
  } catch {
    return false;
  }
}

function Status({ ok }: { ok: boolean }) {
  return <span className={"pill " + (ok ? "ok" : "warn")}>{ok ? t2("configured") : t2("not_configured")}</span>;
}

export default function BillingTab() {
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [general, setGeneral] = useState({ enabled: false, trial_days: "0" });
  const [stripe, setStripe] = useState({ secret: "", webhook: "" });
  const [play, setPlay] = useState({ package: "", product: "", store_url: "", service_account: "" });
  const [fcmAccount, setFcmAccount] = useState("");
  const [busy, setBusy] = useState<Block | "">("");
  const [messages, setMessages] = useState<Partial<Record<Block, string>>>({});

  const say = (block: Block, text: string) => setMessages((m) => ({ ...m, [block]: text }));
  const fillGeneral = (b: BillingInfo) => setGeneral({ enabled: !!b.enabled, trial_days: String(b.trial_days ?? 0) });
  const fillPlay = (b: BillingInfo) =>
    setPlay({ package: b.play?.package || "", product: b.play?.product || "", store_url: b.play?.store_url || "", service_account: "" });

  useEffect(() => {
    (async () => {
      try {
        const b = await api.billing();
        setInfo(b);
        fillGeneral(b);
        fillPlay(b);
      } catch (e: any) {
        setLoadError(e?.message || t2("load_error"));
      }
    })();
  }, []);

  /** Each block saves only its own fields, so unsaved edits in the other blocks are kept. */
  async function save(block: Block, payload: BillingUpdate, after: (b: BillingInfo) => void) {
    setBusy(block);
    say(block, "");
    try {
      const b = await api.saveBilling(payload);
      setInfo(b);
      after(b);
      say(block, t2("saved"));
    } catch (e: any) {
      say(block, e?.message || t2("save_error"));
    } finally {
      setBusy("");
    }
  }

  if (!info) {
    return (
      <div className="card">
        <h3>{t2("bill_title")}</h3>
        <div className={loadError ? "notice" : "muted"}>{loadError || t2("loading")}</div>
      </div>
    );
  }

  const prices = Object.entries(info.stripe?.prices || {});

  return (
    <div className="card">
      <h3>{t2("bill_title")}</h3>
      <div className="stack">
        <div className="section">
          <h4>{t2("bill_general")}</h4>
          <div className="muted">{t2("bill_general_hint")}</div>
          <label className="checkbox">
            <input type="checkbox" checked={general.enabled} onChange={(e) => setGeneral({ ...general, enabled: e.target.checked })} />
            {t2("bill_enabled")}
          </label>
          <label className="label">{t2("bill_trial_days")}</label>
          <input
            className="input"
            type="number"
            min={0}
            max={90}
            value={general.trial_days}
            onChange={(e) => setGeneral({ ...general, trial_days: e.target.value })}
          />
          <div className="muted">{t2("bill_counts", { gift: info.counts?.gift ?? 0, web: info.counts?.web ?? 0, play: info.counts?.play ?? 0 })}</div>
          <div className="row">
            <button
              className="btn primary"
              disabled={busy === "general"}
              onClick={() => save("general", { enabled: general.enabled, trial_days: Math.max(0, Math.min(90, Number(general.trial_days) || 0)) }, fillGeneral)}
            >
              {busy === "general" ? t2("saving") : t2("save")}
            </button>
          </div>
          {messages.general ? <div className="notice">{messages.general}</div> : null}
        </div>

        <div className="section">
          <h4>{t2("bill_stripe")}</h4>
          <div className="muted">{t2("bill_stripe_hint")}</div>
          <label className="label">{t2("bill_stripe_secret")} <Status ok={!!info.stripe?.configured} /></label>
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder={info.stripe?.configured ? t2("bill_secret_placeholder") : "sk_live_…"}
            value={stripe.secret}
            onChange={(e) => setStripe({ ...stripe, secret: e.target.value })}
          />
          <label className="label">{t2("bill_stripe_webhook")} <Status ok={!!info.stripe?.webhook_configured} /></label>
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder={info.stripe?.webhook_configured ? t2("bill_secret_placeholder") : "whsec_…"}
            value={stripe.webhook}
            onChange={(e) => setStripe({ ...stripe, webhook: e.target.value })}
          />
          <label className="label">{t2("bill_webhook_url")}</label>
          <div className="row">
            <input className="input" readOnly value={info.stripe?.webhook_url || ""} onFocus={(e) => e.target.select()} />
            <button
              className="btn"
              onClick={() => {
                try {
                  navigator.clipboard?.writeText(info.stripe?.webhook_url || "");
                } catch {
                  // the field can still be selected and copied by hand
                }
              }}
            >
              {t2("copy")}
            </button>
          </div>
          <div className="muted">
            {t2("bill_prices")}:{" "}
            {prices.length
              ? prices.map(([plan, id]) => `${plan === "monthly" ? t2("bill_price_monthly") : plan === "yearly" ? t2("bill_price_yearly") : plan}: ${id}`).join(" · ")
              : t2("bill_prices_none")}
          </div>
          <div className="row">
            <button
              className="btn primary"
              disabled={busy === "stripe"}
              onClick={() => {
                const payload: { secret?: string; webhook?: string } = {};
                if (stripe.secret.trim()) payload.secret = stripe.secret.trim();
                if (stripe.webhook.trim()) payload.webhook = stripe.webhook.trim();
                if (!payload.secret && !payload.webhook) {
                  say("stripe", t2("bill_nothing_to_save"));
                  return;
                }
                save("stripe", { stripe: payload }, () => setStripe({ secret: "", webhook: "" }));
              }}
            >
              {busy === "stripe" ? t2("saving") : t2("save")}
            </button>
          </div>
          {messages.stripe ? <div className="notice">{messages.stripe}</div> : null}
        </div>

        <div className="section">
          <h4>{t2("bill_play")}</h4>
          <div className="muted">{t2("bill_play_hint")}</div>
          <label className="label">{t2("bill_play_package")}</label>
          <input className="input" placeholder="app.meetgo.android" value={play.package} onChange={(e) => setPlay({ ...play, package: e.target.value })} />
          <label className="label">{t2("bill_play_product")}</label>
          <input className="input" placeholder="meetgo" value={play.product} onChange={(e) => setPlay({ ...play, product: e.target.value })} />
          <label className="label">{t2("bill_play_store_url")}</label>
          <input
            className="input"
            placeholder="https://play.google.com/store/apps/details?id=app.meetgo.android"
            value={play.store_url}
            onChange={(e) => setPlay({ ...play, store_url: e.target.value })}
          />
          <label className="label">{t2("bill_service_account")} <Status ok={!!info.play?.configured} /></label>
          <textarea
            className="textarea"
            rows={5}
            spellCheck={false}
            placeholder={t2("bill_sa_placeholder")}
            value={play.service_account}
            onChange={(e) => setPlay({ ...play, service_account: e.target.value })}
          />
          <div className="row">
            <button
              className="btn primary"
              disabled={busy === "play"}
              onClick={() => {
                const sa = play.service_account.trim();
                if (sa && !validJson(sa)) {
                  say("play", t2("bill_invalid_json"));
                  return;
                }
                save(
                  "play",
                  { play: { package: play.package.trim(), product: play.product.trim(), store_url: play.store_url.trim(), ...(sa ? { service_account: sa } : {}) } },
                  fillPlay,
                );
              }}
            >
              {busy === "play" ? t2("saving") : t2("save")}
            </button>
          </div>
          {messages.play ? <div className="notice">{messages.play}</div> : null}
        </div>

        <div className="section">
          <h4>{t2("bill_fcm")}</h4>
          <div className="muted">{t2("bill_fcm_hint")}</div>
          <label className="label">{t2("bill_service_account")} <Status ok={!!info.fcm?.configured} /></label>
          {info.fcm?.project_id ? <div className="muted">{t2("bill_fcm_project", { id: info.fcm.project_id })}</div> : null}
          <textarea
            className="textarea"
            rows={5}
            spellCheck={false}
            placeholder={t2("bill_sa_placeholder")}
            value={fcmAccount}
            onChange={(e) => setFcmAccount(e.target.value)}
          />
          <div className="row">
            <button
              className="btn primary"
              disabled={busy === "fcm"}
              onClick={() => {
                const sa = fcmAccount.trim();
                if (!sa) {
                  say("fcm", t2("bill_nothing_to_save"));
                  return;
                }
                if (!validJson(sa)) {
                  say("fcm", t2("bill_invalid_json"));
                  return;
                }
                save("fcm", { fcm: { service_account: sa } }, () => setFcmAccount(""));
              }}
            >
              {busy === "fcm" ? t2("saving") : t2("save")}
            </button>
          </div>
          {messages.fcm ? <div className="notice">{messages.fcm}</div> : null}
        </div>
      </div>
    </div>
  );
}
