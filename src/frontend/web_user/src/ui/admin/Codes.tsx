/** Promotional codes: each one as a card with its use and expiry; created and edited in a window. */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, type PromoCode, type PromoCodeIn } from "../../../../web_admin/api";
import { fmtDay, madridYmd, t2 } from "../../../../web_admin/strings";
import { toast } from "../../store";
import { Icon, Modal } from "../common";
import { SectionHead } from "./AdminPage";
import { a } from "./i18n";
import { Badge, Empty, Field, Switch } from "./kit";

const DURATIONS = ["1m", "3m", "6m", "1y", "life"] as const;
type Duration = (typeof DURATIONS)[number] | "date";
type Form = { code: string; aliases: string; duration: Duration; date: string; max: string; public: boolean; expires_on: string };
const EMPTY: Form = { code: "", aliases: "", duration: "1y", date: "", max: "", public: false, expires_on: "" };

const durationLabel = (d: string) => ((DURATIONS as readonly string[]).includes(d) ? t2(`duration_${d}`) : t2("duration_until", { date: fmtDay(d) }));

function toForm(p: PromoCode): Form {
  const known = (DURATIONS as readonly string[]).includes(p.duration);
  return {
    code: p.code, aliases: (p.aliases || []).join(", "), duration: known ? (p.duration as Duration) : "date", date: known ? "" : p.duration,
    max: p.max == null ? "" : String(p.max), public: !!p.public, expires_on: p.expires_on || "",
  };
}

export function Codes() {
  const [codes, setCodes] = useState<PromoCode[] | null>(null);
  const [open, setOpen] = useState<PromoCode | "new" | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = () => api.promoCodes().then((l) => setCodes(l || [])).catch((e) => { setCodes([]); toast(e.message, "error"); });
  useEffect(() => { load(); }, []);
  const today = madridYmd();

  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_codes")} sub={t2("codes_hint")}>
        <button id="adm-code-new" className="btn pri sm" onClick={() => setOpen("new")}><Icon name="plus" size="sm" />{a("cd_new")}</button>
      </SectionHead>
      {codes === null ? <div className="adm-loading">{a("loading")}</div> : codes.length === 0 ? <Empty icon="star" text={t2("codes_empty")} /> : (
        <div className="adm-codes">
          {codes.map((p) => {
            const pct = p.max ? Math.min(100, Math.round((p.used / p.max) * 100)) : 0;
            const expired = !!p.expires_on && p.expires_on < today;
            const full = p.max != null && p.used >= p.max;
            return (
              <article key={p.code} className={"adm-card adm-code" + (expired || full ? " dim" : "")}>
                <div className="adm-code-top">
                  <button className="adm-code-name" title={a("cd_copy")} onClick={() => navigator.clipboard?.writeText(p.code).then(() => toast(a("ud_copied"))).catch(() => undefined)}>
                    {p.code}<Icon name="copy" size="sm" />
                  </button>
                  <Badge tone={expired ? "gray" : full ? "orange" : "green"}>{expired ? a("cd_expired") : full ? a("cd_full") : a("cd_active")}</Badge>
                  <Badge tone={p.public ? "blue" : "gray"}>{p.public ? t2("codes_public") : t2("codes_private")}</Badge>
                </div>
                {p.aliases?.length ? <div className="muted adm-code-al">{t2("codes_aliases", { list: p.aliases.join(", ") })}</div> : null}
                <div className="adm-code-facts">
                  <span><Icon name="star" size="sm" />{durationLabel(p.duration)}</span>
                  <span><Icon name="calendar" size="sm" />{p.expires_on ? t2(expired ? "codes_expired" : "codes_expires", { date: fmtDay(p.expires_on) }) : t2("codes_no_expiry")}</span>
                </div>
                <div className="adm-code-use">
                  <span>{p.max == null ? a("cd_used_free", { used: p.used }) : a("cd_used", { used: p.used, max: p.max })}</span>
                  {p.max != null ? <span className="track"><i style={{ width: `${pct}%` }} className={pct >= 100 ? "full" : ""} /></span> : null}
                </div>
                {confirm === p.code ? (
                  <div className="adm-actions">
                    <span className="grow">{t2("codes_delete_confirm", { code: p.code })}</span>
                    <button className="btn sm dangerfill" onClick={() => api.deletePromoCode(p.code).then(() => { toast(t2("codes_deleted")); setConfirm(null); load(); }).catch((e) => toast(e.message, "error"))}>{t2("codes_delete_yes")}</button>
                    <button className="btn sm" onClick={() => setConfirm(null)}>{a("cancel")}</button>
                  </div>
                ) : (
                  <div className="adm-actions">
                    <button className="btn sm" onClick={() => setOpen(p)}><Icon name="edit" size="sm" />{t2("codes_edit")}</button>
                    <button className="btn sm danger" onClick={() => setConfirm(p.code)}><Icon name="trash" size="sm" />{t2("codes_delete")}</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {open ? <CodeForm code={open === "new" ? null : open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} /> : null}
    </div>
  );
}

function CodeForm({ code, onClose, onSaved }: { code: PromoCode | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(code ? toForm(code) : EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    const c = form.code.trim();
    const aliases = form.aliases.split(",").map((x) => x.trim()).filter(Boolean);
    const max = form.max.trim();
    const fail = c.length < 2 ? "codes_code_required" : aliases.length > 10 ? "codes_too_many_aliases"
      : max && !(Number.isInteger(Number(max)) && Number(max) >= 1) ? "codes_max_invalid" : form.duration === "date" && !form.date ? "codes_date_required" : "";
    if (fail) return toast(t2(fail), "error");
    const payload: PromoCodeIn = {
      code: c, aliases, duration: form.duration === "date" ? form.date : form.duration,
      max_uses: max ? Number(max) : null, public: form.public, expires_on: form.expires_on || null,
    };
    setBusy(true);
    try {
      await api.savePromoCode(payload);
      toast(t2("codes_saved"));
      onSaved();
    } catch (e: any) {
      toast(e?.message || a("save_error"), "error");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <Modal title={code ? t2("codes_form_edit", { code: code.code }) : t2("codes_form_new")} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{a("cancel")}</button><button className="btn pri" disabled={busy} onClick={save}>{t2("codes_save")}</button></>}>
      <Field label={t2("codes_code")}><input className="inp" placeholder="LANZAMIENTO" readOnly={!!code} value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
      <Field label={t2("codes_aliases_input")}><input className="inp" placeholder="MEETGO50" value={form.aliases} onChange={(e) => set({ aliases: e.target.value })} /></Field>
      <Field label={t2("codes_duration_label")}>
        <select className="inp" value={form.duration} onChange={(e) => set({ duration: e.target.value as Duration })}>
          {DURATIONS.map((d) => <option key={d} value={d}>{t2(`duration_${d}`)}</option>)}
          <option value="date">{t2("duration_date")}</option>
        </select>
      </Field>
      {form.duration === "date" ? <Field label={t2("duration_date")}><input className="inp" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} /></Field> : null}
      <div className="adm-grid">
        <Field label={t2("codes_max")}><input className="inp" type="number" min={1} value={form.max} onChange={(e) => set({ max: e.target.value })} /></Field>
        <Field label={t2("codes_expires_label")}><input className="inp" type="date" value={form.expires_on} onChange={(e) => set({ expires_on: e.target.value })} /></Field>
      </div>
      <Switch id="adm-code-public" label={t2("codes_public_label")} on={form.public} onChange={(v) => set({ public: v })} />
    </Modal>,
    document.body,
  );
}
