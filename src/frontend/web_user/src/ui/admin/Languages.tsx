/** The app's languages: how complete each one is, which ones people can pick, and new ones translated by Claude. */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type AdminLanguage } from "../../../../web_admin/api";
import { toast } from "../../store";
import { Icon, Modal } from "../common";
import { a } from "./i18n";
import { Badge, Field } from "./kit";

/** Languages one may add (left to right scripts; the app is not laid out for right to left yet). */
const SUGGESTED: [string, string][] = [
  ["pt-br", "Português (Brasil)"], ["eu", "Euskara"], ["gl", "Galego"], ["ro", "Română"], ["pl", "Polski"],
  ["sv", "Svenska"], ["da", "Dansk"], ["no", "Norsk"], ["fi", "Suomi"], ["el", "Ελληνικά"], ["tr", "Türkçe"],
  ["ru", "Русский"], ["uk", "Українська"], ["cs", "Čeština"], ["hu", "Magyar"], ["hr", "Hrvatski"], ["bg", "Български"],
  ["ko", "한국어"], ["hi", "हिन्दी"], ["id", "Bahasa Indonesia"], ["vi", "Tiếng Việt"], ["th", "ไทย"],
];

export function Languages({ aiReady }: { aiReady: boolean }) {
  const [list, setList] = useState<AdminLanguage[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const timer = useRef<number>();

  const load = () => api.languages().then(setList).catch((e) => toast(e.message, "error"));
  useEffect(() => { load(); return () => window.clearTimeout(timer.current); }, []);
  // while Claude translates, the progress is read again every few seconds
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (list?.some((l) => l.job?.state === "running")) timer.current = window.setTimeout(load, 3000);
  }, [list]);

  const run = (fn: () => Promise<AdminLanguage[]>, done?: string) =>
    fn().then((l) => { setList(l); if (done) toast(done); }).catch((e) => toast(e?.message || a("save_error"), "error"));

  if (!list) return <div className="adm-loading">{a("loading")}</div>;
  return (
    <>
      <p className="muted adm-note">{a("la_hint")}</p>
      <div className="adm-langs">
        {list.map((l) => {
          const job = l.job;
          const running = job?.state === "running";
          const done = running ? job!.done : l.translated;
          const pct = Math.round((done / Math.max(1, running ? job!.total : l.total)) * 100);
          return (
            <div key={l.code} className="adm-lang">
              <span className="adm-lang-code">{l.code}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="adm-urow-name">
                  <b>{l.name}</b>
                  {l.code === "en" ? <Badge tone="blue">{a("la_source")}</Badge> : null}
                  {!l.builtin ? <Badge tone="violet">{a("la_added")}</Badge> : null}
                  {running ? <Badge tone="orange">{a("la_translating")}</Badge> : null}
                  {job?.state === "error" ? <Badge tone="red" title={job.error}>{a("la_error")}</Badge> : null}
                </div>
                <div className="adm-lang-bar"><span className="track"><i style={{ width: `${pct}%` }} className={pct >= 100 ? "full" : ""} /></span><small>{pct}% · {done}/{running ? job!.total : l.total}</small></div>
                {job?.state === "error" && job.error ? <small className="adm-red">{job.error}</small> : null}
                {!l.builtin && !running ? (
                  <div className="adm-actions" style={{ marginTop: 6 }}>
                    {pct < 100 ? <button className="btn sm" disabled={!aiReady} onClick={() => run(() => api.completeLanguage(l.code))}><Icon name="star" size="sm" />{a("la_complete")}</button> : null}
                    {confirm === l.code ? (
                      <>
                        <button className="btn sm dangerfill" onClick={() => run(() => api.deleteLanguage(l.code), a("la_deleted")).then(() => setConfirm(null))}>{a("co_delete_yes")}</button>
                        <button className="btn sm" onClick={() => setConfirm(null)}>{a("cancel")}</button>
                      </>
                    ) : <button className="btn sm danger" onClick={() => setConfirm(l.code)}><Icon name="trash" size="sm" />{a("co_delete_yes")}</button>}
                  </div>
                ) : null}
              </div>
              <label className="adm-mini-switch" title={l.enabled ? a("la_shown") : a("la_hidden")}>
                <input type="checkbox" role="switch" aria-label={l.name} checked={l.enabled} disabled={l.code === "en" || running}
                  onChange={(e) => run(() => api.editLanguage(l.code, { enabled: e.target.checked }))} />
                <span className="sw" aria-hidden="true" />
              </label>
            </div>
          );
        })}
      </div>
      <button id="adm-lang-add" className="btn pri sm" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}><Icon name="plus" size="sm" />{a("la_add")}</button>
      {!aiReady ? <p className="adm-red adm-note">{a("la_needs_ai")}</p> : null}
      {adding ? <AddLanguage taken={list.map((l) => l.code)} aiReady={aiReady} onClose={() => setAdding(false)}
        onAdded={(l) => { setList(l); setAdding(false); toast(a("la_started")); }} /> : null}
    </>
  );
}

function AddLanguage({ taken, aiReady, onClose, onAdded }: { taken: string[]; aiReady: boolean; onClose: () => void; onAdded: (l: AdminLanguage[]) => void }) {
  const options = SUGGESTED.filter(([c]) => !taken.includes(c));
  const [pick, setPick] = useState(options[0]?.[0] || "other");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [finalCode, finalName] = pick === "other" ? [code.trim().toLowerCase(), name.trim()] : (SUGGESTED.find(([c]) => c === pick) || ["", ""]);

  return createPortal(
    <Modal title={a("la_add")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{a("cancel")}</button>
      <button className="btn pri" disabled={busy || !aiReady || !finalCode || !finalName} onClick={() => {
        setBusy(true);
        api.addLanguage(finalCode, finalName).then(onAdded).catch((e) => toast(e?.message || a("save_error"), "error")).finally(() => setBusy(false));
      }}><Icon name="star" size="sm" />{a("la_translate")}</button>
    </>}>
      <p className="muted adm-note">{a("la_add_hint")}</p>
      <Field label={a("la_language")}>
        <select className="inp" value={pick} onChange={(e) => setPick(e.target.value)}>
          {options.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
          <option value="other">{a("la_other")}</option>
        </select>
      </Field>
      {pick === "other" ? (
        <div className="adm-grid">
          <Field label={a("la_code")} hint={a("la_code_hint")}><input className="inp" placeholder="lt" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label={a("la_name")} hint={a("la_name_hint")}><input className="inp" placeholder="Lietuvių" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
      ) : null}
      <div className="adm-steps"><b>{a("la_cost")}</b><span className="muted">{a("la_cost_hint")}</span></div>
    </Modal>,
    document.body,
  );
}
