/** MeetGo's settings, by topic, with one bar to save or discard every change. */
import React, { useEffect, useMemo, useState } from "react";
import { t } from "@lang";
import { api } from "../../../../web_admin/api";
import { toast } from "../../store";
import { Icon, countryOptions } from "../common";
import { SectionHead } from "./AdminPage";
import { a } from "./i18n";
import { Field, Fold, Switch } from "./kit";

type Row = Record<string, any>;

/** Editable rows (languages, age ranges, countries, calling codes): one line per item with its fields. */
function Rows({ rows, fields, onChange, add }: {
  rows: Row[]; fields: ([string, string] | [string, string, "number"])[]; onChange: (rows: Row[]) => void; add: Row;
}) {
  return (
    <div className="adm-rows">
      {rows.map((r, i) => (
        <div key={i} className="adm-rowedit" style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr)) auto` }}>
          {fields.map(([k, label, type]) => (
            <input key={k} className="inp" aria-label={label} placeholder={label} type={type || "text"} value={r[k] ?? ""}
              onChange={(e) => {
                const next = [...rows];
                const v = e.target.value;
                next[i] = { ...next[i], [k]: type === "number" ? (v === "" ? null : Number(v)) : v };
                onChange(next);
              }} />
          ))}
          <button className="iconbtn" aria-label={t("admin_delete")} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon name="trash" size="sm" /></button>
        </div>
      ))}
      <button className="btn sm" onClick={() => onChange([...rows, { ...add }])}><Icon name="plus" size="sm" />{a("add")}</button>
    </div>
  );
}

export function Settings() {
  const [saved, setSaved] = useState<Row | null>(null);
  const [s, setS] = useState<Row | null>(null);
  const [provCountry, setProvCountry] = useState("ES");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.settings().then((r: Row) => { setSaved(r || {}); setS(r || {}); }).catch((e) => toast(e.message, "error")); }, []);
  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(saved), [s, saved]);

  if (!s) return <div className="adm-loading">{a("loading")}</div>;
  const put = (path: string, value: unknown) => setS((prev) => {
    const next = structuredClone(prev || {});
    const parts = path.split(".");
    let cur: any = next;
    for (const p of parts.slice(0, -1)) cur = cur[p] = cur[p] ?? {};
    cur[parts[parts.length - 1]] = value;
    return next;
  });
  const smtp = s.smtp || {};
  const mail = s.email_notifications || {};
  const provinces: { value: string; name: string }[] = s.provinces_by_country?.[provCountry] || [];
  const provText = provinces.map((p) => (p.value && p.value !== p.name ? `${p.value} = ${p.name}` : p.name || p.value)).join("\n");

  async function save() {
    setBusy(true);
    try {
      const updated = await api.saveSettings(s);
      setSaved(updated || s);
      setS(updated || s);
      toast(a("se_saved"));
    } catch (e: any) {
      toast(e?.message || a("save_error"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_settings")} />

      <Fold icon="home" title={a("se_general")} summary={s.app_base_url || "—"}>
        <Field label={t("admin_base_url")}><input className="inp" placeholder={t("admin_base_url_placeholder")} value={s.app_base_url || ""} onChange={(e) => put("app_base_url", e.target.value)} /></Field>
      </Fold>

      <Fold icon="bell" title={a("se_emails")} summary={(mail.enabled ?? true) ? a("bi_on") : a("bi_off")}>
        <Switch id="adm-set-mail" label={t("admin_email_notifications_enabled")} on={mail.enabled ?? true} onChange={(v) => put("email_notifications.enabled", v)} />
        <div className="adm-grid">
          <Field label={t("admin_email_notifications_delay")}><input className="inp" type="number" min={1} value={mail.delay_minutes ?? 15} onChange={(e) => put("email_notifications.delay_minutes", Number(e.target.value) || 1)} /></Field>
          <Field label={t("admin_email_notifications_cooldown")}><input className="inp" type="number" min={0} step={0.5} value={mail.cooldown_hours ?? 3} onChange={(e) => put("email_notifications.cooldown_hours", Number(e.target.value) || 0)} /></Field>
        </div>
        <p className="muted adm-note">{t("admin_email_notifications_hint")}</p>
      </Fold>

      <Fold icon="send" title={a("se_smtp")} summary={smtp.mode === "gmail_api" ? t("admin_smtp_mode_gmail") : smtp.host || "—"}>
        <div className="adm-grid">
          <Field label={t("admin_smtp_mode")}>
            <select className="inp" value={smtp.mode || "smtp"} onChange={(e) => put("smtp.mode", e.target.value)}>
              <option value="smtp">{t("admin_smtp_mode_smtp")}</option>
              <option value="gmail_api">{t("admin_smtp_mode_gmail")}</option>
            </select>
          </Field>
          <Field label={t("admin_smtp_encryption")}>
            <select className="inp" value={smtp.encryption || "starttls"} onChange={(e) => put("smtp.encryption", e.target.value)}>
              <option value="starttls">{t("admin_smtp_starttls")}</option>
              <option value="ssl">{t("admin_smtp_ssl")}</option>
            </select>
          </Field>
          <Field label={t("admin_smtp_host")}><input className="inp" value={smtp.host || ""} onChange={(e) => put("smtp.host", e.target.value)} /></Field>
          <Field label={t("admin_smtp_port")}><input className="inp" value={smtp.port || ""} onChange={(e) => put("smtp.port", e.target.value)} /></Field>
          <Field label={t("admin_smtp_username")}><input className="inp" autoComplete="off" value={smtp.username || ""} onChange={(e) => put("smtp.username", e.target.value)} /></Field>
          <Field label={t("admin_smtp_password")}><input className="inp" type="password" autoComplete="new-password" value={smtp.password || ""} onChange={(e) => put("smtp.password", e.target.value)} /></Field>
          <Field label={t("admin_smtp_from_email")}><input className="inp" value={smtp.from_email || ""} onChange={(e) => put("smtp.from_email", e.target.value)} /></Field>
        </div>
        {smtp.mode === "gmail_api" ? (
          <div className="adm-grid">
            <Field label={t("admin_gmail_client_id")}><input className="inp" value={smtp.gmail_client_id || ""} onChange={(e) => put("smtp.gmail_client_id", e.target.value)} /></Field>
            <Field label={t("admin_gmail_client_secret")}><input className="inp" type="password" value={smtp.gmail_client_secret || ""} onChange={(e) => put("smtp.gmail_client_secret", e.target.value)} /></Field>
            <Field label={t("admin_gmail_refresh_token")}><input className="inp" type="password" value={smtp.gmail_refresh_token || ""} onChange={(e) => put("smtp.gmail_refresh_token", e.target.value)} /></Field>
            <Field label={t("admin_gmail_sender_email")}><input className="inp" value={smtp.gmail_sender_email || ""} onChange={(e) => put("smtp.gmail_sender_email", e.target.value)} /></Field>
          </div>
        ) : null}
        <div className="adm-test">
          <input className="inp" type="email" placeholder={t("admin_smtp_test_email")} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn sm" disabled={!testTo.trim()} onClick={() => api.smtpTest(testTo.trim()).then(() => toast(t("admin_smtp_test_ok"))).catch((e) => toast(e?.message || t("admin_smtp_test_error"), "error"))}>
            <Icon name="send" size="sm" />{t("admin_smtp_test_button")}
          </button>
        </div>
      </Fold>

      <Fold icon="chat" title={a("se_languages")} summary={a("se_items", { n: (s.languages || []).length })}>
        <Rows rows={s.languages || []} add={{ code: "", name: "" }} fields={[["code", t("admin_code")], ["name", t("admin_name")]]} onChange={(r) => put("languages", r)} />
      </Fold>

      <Fold icon="calendar" title={a("se_ages")} summary={(s.age_ranges || []).map((r: Row) => r.label || r.key).join(" · ")}>
        <Rows rows={s.age_ranges || []} add={{ key: "", label: "", min: 18, max: null }}
          fields={[["key", t("admin_key")], ["label", t("admin_label")], ["min", t("admin_min"), "number"], ["max", t("admin_max"), "number"]]}
          onChange={(r) => put("age_ranges", r)} />
      </Fold>

      <Fold icon="place" title={a("se_countries")} summary={a("se_items", { n: (s.countries || []).length })}>
        <div className="adm-two">
          <div>
            <h4>{t("admin_countries_title")}</h4>
            <Rows rows={s.countries || []} add={{ code: "", name: "" }} fields={[["code", t("admin_code")], ["name", t("admin_name")]]} onChange={(r) => put("countries", r)} />
          </div>
          <div>
            <h4>{t("admin_calling_codes_title")}</h4>
            <Rows rows={s.calling_codes || []} add={{ cc: "", name: "" }} fields={[["cc", t("admin_calling_code_placeholder")], ["name", t("admin_name")]]} onChange={(r) => put("calling_codes", r)} />
          </div>
        </div>
      </Fold>

      <Fold icon="compass" title={a("se_provinces")} summary={`${provCountry} · ${a("se_items", { n: provinces.length })}`}>
        <Field label={t("ui_country")}>
          <select className="inp" value={provCountry} onChange={(e) => setProvCountry(e.target.value)}>
            {countryOptions(s.countries).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Field>
        <textarea className="inp mono" rows={10} value={provText} onChange={(e) => {
          const lines = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean);
          const list = lines.map((l) => {
            const [value, name] = l.includes(" = ") ? l.split(" = ", 2).map((x) => x.trim()) : [l, l];
            return { value, name };
          });
          put("provinces_by_country", { ...(s.provinces_by_country || {}), [provCountry]: list });
        }} />
      </Fold>

      {dirty ? (
        <div className="adm-savebar" role="status">
          <span className="grow">{a("se_unsaved")}</span>
          <button className="btn sm" onClick={() => setS(saved)}>{a("se_discard")}</button>
          <button id="adm-set-save" className="btn pri sm" disabled={busy} onClick={save}>{a("se_save")}</button>
        </div>
      ) : null}
    </div>
  );
}
