/** Administration → Logs: every call to the API of the last 30 days (who, when, what kind, how it went, from where),
 * newest first, filtered by person, kind, result, method, text and dates. */
import React, { useEffect, useRef, useState } from "react";
import { api, type AdminLog } from "../../../../web_admin/api";
import { toast } from "../../store";
import { Icon } from "../common";
import { SectionHead } from "./AdminPage";
import { a } from "./i18n";
import { Badge, Empty } from "./kit";

const KINDS = ["auth", "account", "messages", "communities", "board", "social", "billing", "admin", "other"];
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];
type Filters = { user: string; kind: string; result: string; method: string; q: string; since: string; until: string };
const EMPTY: Filters = { user: "", kind: "", result: "", method: "", q: "", since: "", until: "" };

/** "2026-11-26T03:21" (the date picker, local time) → ISO with the time zone. */
const iso = (v: string) => (v ? new Date(v).toISOString() : undefined);

export function Logs({ initialUser }: { initialUser?: string }) {
  const [f, setF] = useState<Filters>({ ...EMPTY, user: initialUser || "" });
  const [rows, setRows] = useState<AdminLog[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = useRef(true);
  const [open, setOpen] = useState<number | null>(null);
  const timer = useRef<number>();
  const set = (patch: Partial<Filters>) => setF((x) => ({ ...x, ...patch }));
  const params = (before?: number) => ({ user: f.user.trim(), kind: f.kind, result: f.result, method: f.method, q: f.q.trim(),
    since: iso(f.since), until: iso(f.until), before_id: before, limit: 100 });
  const load = (before?: number) => {
    setBusy(true);
    setError("");
    api.adminLogs(params(before)).then((r) => {
      setRows((old) => (before && old ? [...old, ...r.rows] : r.rows));
      setMore(r.more);
    }).catch((e) => { setError(e.message || "error"); if (before) toast(e.message, "error"); }).finally(() => setBusy(false));
  };
  // typing waits a moment; the drop-downs and dates apply at once
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (first.current) { first.current = false; load(); return; }  // the first time, at once
    timer.current = window.setTimeout(() => load(), 350);
    return () => window.clearTimeout(timer.current);
  }, [f]);
  const filtered = Object.values(f).some(Boolean);
  const tone = (s: number) => (s >= 500 ? "red" : s >= 400 ? "orange" : "green");

  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_logs")} sub={a("lg_lead")}>
        <button className="btn sm" onClick={() => load()} disabled={busy}>{a("refresh")}</button>
      </SectionHead>
      <div className="lg-filters">
        <div className="adm-search"><Icon name="user" size="sm" />
          <input id="lg-search-user" className="inp" type="search" autoComplete="off" autoCorrect="off" spellCheck={false} placeholder={a("lg_user_ph")} value={f.user} onChange={(e) => set({ user: e.target.value })} /></div>
        <div className="adm-search"><Icon name="search" size="sm" />
          <input id="lg-search-path" className="inp" type="search" autoComplete="off" autoCorrect="off" spellCheck={false} placeholder={a("lg_q_ph")} value={f.q} onChange={(e) => set({ q: e.target.value })} /></div>
        <select id="lg-kind" className="inp adm-sort" value={f.kind} onChange={(e) => set({ kind: e.target.value })} aria-label={a("lg_kind")}>
          <option value="">{a("lg_kind_all")}</option>
          {KINDS.map((k) => <option key={k} value={k}>{a(`lg_kind_${k}`)}</option>)}
        </select>
        <select id="lg-result" className="inp adm-sort" value={f.result} onChange={(e) => set({ result: e.target.value })} aria-label={a("lg_result")}>
          <option value="">{a("lg_result_all")}</option>
          <option value="ok">{a("lg_result_ok")}</option>
          <option value="4xx">{a("lg_result_4xx")}</option>
          <option value="5xx">{a("lg_result_5xx")}</option>
        </select>
        <select id="lg-method" className="inp adm-sort" value={f.method} onChange={(e) => set({ method: e.target.value })} aria-label={a("lg_method")}>
          <option value="">{a("lg_method_all")}</option>
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="lg-dates">
        <label className="lg-date">{a("lg_since")}<input id="lg-since" className="inp" type="datetime-local" value={f.since} onChange={(e) => set({ since: e.target.value })} /></label>
        <label className="lg-date">{a("lg_until")}<input id="lg-until" className="inp" type="datetime-local" value={f.until} onChange={(e) => set({ until: e.target.value })} /></label>
        </div>
        {filtered ? <button className="btn sm" onClick={() => setF(EMPTY)}>{a("lg_clear")}</button> : null}
      </div>

      {error && !busy ? (
        <div className="adm-loading">{a("lg_error")} <button className="btn sm" onClick={() => load()}>{a("lg_retry")}</button></div>
      ) : rows === null ? <div className="adm-loading">{a("loading")}</div> : rows.length === 0 ? <Empty icon="search" text={a("lg_empty")} /> : (
        <div className="lg-list">
          {rows.map((r) => (
            <div key={r.id} className={"lg-row" + (open === r.id ? " open" : "")}>
              <button type="button" className="lg-main" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="lg-time">{new Date(r.at).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <Badge tone={tone(r.status)}>{r.status}</Badge>
                <span className="lg-method">{r.method}</span>
                <span className="lg-path">{r.path}</span>
                <Badge tone="gray">{a(`lg_kind_${r.kind}`)}</Badge>
                <span className="lg-ms">{r.ms} ms</span>
              </button>
              <span className="lg-who">
                {r.user ? <button type="button" className="linkbtn" title={a("lg_only_user")} onClick={() => set({ user: String(r.user!.id) })}>{r.user.name || `#${r.user.id}`}</button>
                  : <span className="muted">{a("lg_nobody")}</span>}
              </span>
              {open === r.id ? (
                <div className="lg-more">
                  <div><b>{a("lg_user")}</b> {r.user ? `${r.user.name || ""} · ${r.user.email || ""} · #${r.user.id}` : a("lg_nobody")}</div>
                  <div><b>IP</b> {r.ip || "—"}</div>
                  <div><b>{a("lg_agent")}</b> {r.agent || "—"}</div>
                  <div><b>{a("lg_when")}</b> {new Date(r.at).toLocaleString()}</div>
                  <div className="lg-fullpath"><b>{a("lg_path")}</b> {r.method} {r.path}</div>
                </div>
              ) : null}
            </div>
          ))}
          {more ? <button className="btn" disabled={busy} onClick={() => load(rows[rows.length - 1].id)}>{a("lg_more")}</button> : null}
        </div>
      )}
    </div>
  );
}
