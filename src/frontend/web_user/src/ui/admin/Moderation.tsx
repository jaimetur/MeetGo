/** Reported messages: what was said, who said it and who reported it, with the decision one tap away. */
import React, { useEffect, useState } from "react";
import { api, API_BASE, type Report, type ReportStatus } from "../../../../web_admin/api";
import { t2 } from "../../../../web_admin/strings";
import { toast } from "../../store";
import { Avatar, Icon } from "../common";
import { SectionHead } from "./AdminPage";
import { a, ago, fmtDateTime } from "./i18n";
import { Badge, Empty } from "./kit";

const TABS: [ReportStatus, string][] = [["open", "mo_open"], ["actioned", "mo_actioned"], ["dismissed", "mo_dismissed"]];

const abs = (u: string) => (/^https?:\/\//.test(u) ? u : API_BASE + u);

function reason(r: string) {
  const key = `mod_reason_${r}`;
  const s = t2(key);
  return s === key ? r : s;
}

export function Moderation({ onCount }: { onCount: (n: number) => void }) {
  const [status, setStatus] = useState<ReportStatus>("open");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = (s = status) => api.reports(s).then((list) => {
    setReports(list || []);
    if (s === "open") onCount((list || []).length);
  }).catch((e) => { setReports([]); toast(e.message, "error"); });
  useEffect(() => { setReports(null); load(status); }, [status]);

  async function act(r: Report, fn: () => Promise<unknown>, done?: string) {
    setBusy(r.id);
    try {
      await fn();
      if (done) toast(done);
      await load();
    } catch (e: any) {
      toast(e?.message || a("save_error"), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_moderation")} sub={t2("mod_hint")}>
        <button className="btn sm" onClick={() => load()}>{a("refresh")}</button>
      </SectionHead>
      <div className="segtabs adm-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} id={`adm-mod-${k}`} role="tab" aria-selected={status === k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{a(label)}</button>
        ))}
      </div>

      {reports === null ? <div className="adm-loading">{a("loading")}</div> : reports.length === 0
        ? <Empty icon="check2" text={status === "open" ? a("mo_empty_open") : a("mo_empty")} /> : (
          <div className="adm-reports">
            {reports.map((r) => {
              const m = r.message;
              return (
                <article key={r.id} className="adm-card adm-report">
                  <div className="adm-report-top">
                    <Badge tone="red"><Icon name="flag" size="sm" />{reason(r.reason)}</Badge>
                    <span className="muted">#{r.id} · {ago(r.created_at)}</span>
                  </div>
                  <div className="adm-report-by"><Avatar user={r.reporter} size={22} />{a("mo_by", { name: r.reporter?.display_name || t2("mod_unknown_user") })}</div>
                  {r.details ? <p className="adm-report-details">“{r.details}”</p> : null}
                  {m ? (
                    <div className="adm-quote">
                      <div className="adm-quote-head">
                        <Avatar user={m.sender} size={30} />
                        <b>{m.sender?.display_name || t2("mod_unknown_user")}</b>
                        <span className="muted">{fmtDateTime(m.created_at)} · {a("mo_in_chat", { id: m.conversation_id })}</span>
                      </div>
                      {m.deleted ? (
                        <>
                          <Badge tone="orange">{t2("mod_message_deleted")}</Badge>
                          {m.original_body ? <div className="adm-quote-body removed">{m.original_body}</div> : null}
                        </>
                      ) : <div className="adm-quote-body">{m.body || t2("mod_no_text")}</div>}
                      {m.attachments?.length ? (
                        <div className="adm-thumbs">
                          {m.attachments.map((at) => (
                            <a key={at.id} href={abs(at.url)} target="_blank" rel="noreferrer">
                              {at.thumb_url ? <img src={abs(at.thumb_url)} alt={at.file_name} /> : <span><Icon name="file" size="sm" />{at.file_name}</span>}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : <div className="muted">{t2("mod_message_missing")}</div>}

                  {r.status === "open" ? (
                    <div className="adm-actions">
                      <button className="btn sm" disabled={busy === r.id} onClick={() => act(r, () => api.resolveReport(r.id, { status: "dismissed", delete_message: false }))}>
                        <Icon name="x" size="sm" />{a("mo_dismiss")}
                      </button>
                      {m && !m.deleted ? (
                        <button className="btn sm danger" disabled={busy === r.id} onClick={() => act(r, () => api.resolveReport(r.id, { status: "actioned", delete_message: true }))}>
                          <Icon name="trash" size="sm" />{a("mo_delete")}
                        </button>
                      ) : (
                        <button className="btn sm" disabled={busy === r.id} onClick={() => act(r, () => api.resolveReport(r.id, { status: "actioned", delete_message: false }))}>
                          <Icon name="check" size="sm" />{a("mo_done")}
                        </button>
                      )}
                      {m?.sender ? (
                        <button className="btn sm danger" disabled={busy === r.id}
                          onClick={() => act(r, () => api.banUser(m.sender!.id, 7), a("mo_banned", { name: m.sender!.display_name }))}>
                          <Icon name="shield" size="sm" />{a("mo_ban7")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
    </div>
  );
}
