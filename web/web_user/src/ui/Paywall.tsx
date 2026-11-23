import React, { useEffect, useState } from "react";
import { t } from "@lang";
import { api } from "../api";
import { isNativeApp, native, setNativeHandlers } from "../native";
import { setState, toast, useStore } from "../store";
import type { BillingStatus, Plans } from "../types";
import { euros } from "../util";
import { Modal } from "./common";

export function Paywall({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t("ui_paywall_title")} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>{t("ui_paywall_lead")}</p>
      <PlanPicker onDone={onClose} />
    </Modal>
  );
}

export function PlanPicker({ onDone }: { onDone?: () => void }) {
  const billing = useStore((s) => s.billing);
  const [plans, setPlans] = useState<Plans | null>(null);
  const [plan, setPlan] = useState<"monthly" | "yearly">("yearly");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const playProducts = isNativeApp ? native.billingProducts() : [];
  const usePlay = isNativeApp && playProducts.length > 0;

  useEffect(() => {
    api.plans().then(setPlans).catch(() => undefined);
    setNativeHandlers({
      purchase: async (res) => {
        if (res.error || !res.token) {
          if (res.error) toast(res.error, "error");
          setBusy(false);
          return;
        }
        try {
          const status = await api.playLink(res.token, res.product);
          setState({ billing: status });
          toast(t("ui_plan_active"));
          onDone?.();
        } catch (e: any) {
          toast(e.message, "error");
        } finally {
          setBusy(false);
        }
      },
    });
  }, []);

  async function subscribe() {
    setBusy(true);
    if (usePlay) {
      native.subscribe(plan);
      return;
    }
    try {
      const { url } = await api.checkout(plan);
      window.location.href = url;
    } catch (e: any) {
      toast(e.message, "error");
      setBusy(false);
    }
  }

  async function redeem() {
    try {
      const status = await api.redeem(code.trim());
      setState({ billing: status });
      toast(t("ui_code_applied"));
      onDone?.();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  const price = (id: string) => {
    const p = playProducts.find((x) => x.plan === id);
    if (p) return p.price;
    const amount = plans?.plans.find((x) => x.id === id)?.amount ?? (id === "monthly" ? 250 : 2500);
    return euros(amount);
  };
  const trial = plans?.trial_days ?? 7;
  const canPay = usePlay || !!plans?.stripe;

  return (
    <div className="stack">
      <div className="grid2">
        {(["monthly", "yearly"] as const).map((id) => (
          <button key={id} className={"plan" + (plan === id ? " on" : "")} onClick={() => setPlan(id)} aria-pressed={plan === id}>
            {id === "yearly" ? <span className="save">{t("ui_save_17")}</span> : null}
            <span className="muted">{id === "monthly" ? t("ui_monthly") : t("ui_yearly")}</span>
            <span className="price">{price(id)}</span>
            <span className="muted" style={{ fontSize: 12.5 }}>{id === "monthly" ? t("ui_per_month") : t("ui_per_year")}</span>
          </button>
        ))}
      </div>
      {trial && !billing?.stripe && !billing?.grant ? <div className="muted" style={{ fontSize: 13 }}>{t("ui_trial_days", { n: trial })}</div> : null}
      <button className="btn pri block" disabled={busy || !canPay} onClick={subscribe}>{busy ? t("ui_wait") : usePlay ? t("ui_subscribe_play") : t("ui_subscribe_card")}</button>
      {!canPay ? <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_payments_soon")}</div> : null}
      {usePlay ? <button className="linkbtn" onClick={() => native.restorePurchase()}>{t("ui_restore_purchase")}</button> : null}
      <div className="row">
        <input id="redeem-code" className="inp" placeholder={t("ui_promo_code")} value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn" disabled={!code.trim()} onClick={redeem}>{t("ui_apply")}</button>
      </div>
    </div>
  );
}

export function describeBilling(b: BillingStatus | null): string {
  if (!b) return "";
  if (b.source === "free") return t("ui_access_free");
  if (b.source === "grant") return b.grant?.until ? t("ui_access_grant_until", { date: new Date(b.grant.until).toLocaleDateString() }) : t("ui_access_grant_life");
  if (b.source === "stripe" && b.stripe) {
    const plan = b.stripe.plan === "yearly" ? t("ui_yearly") : t("ui_monthly");
    const date = b.stripe.period_end ? new Date(b.stripe.period_end).toLocaleDateString() : "";
    if (b.stripe.status === "trialing") return t("ui_access_trial", { plan, date });
    return b.stripe.cancel_at_period_end ? t("ui_access_ends", { plan, date }) : t("ui_access_renews", { plan, date });
  }
  if (b.source === "play" && b.play) return t("ui_access_play", { date: b.play.expiry ? new Date(b.play.expiry).toLocaleDateString() : "" });
  return t("ui_access_none");
}
