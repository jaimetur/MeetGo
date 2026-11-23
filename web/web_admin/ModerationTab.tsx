import { useEffect, useState } from "react";
import { api, API_BASE, type Report, type ReportStatus } from "./api";
import { fmtDateTime, t2 } from "./strings";

const STATUSES: ReportStatus[] = ["open", "dismissed", "actioned"];

/** Attachment links come as API paths ("/files/..."). */
function absUrl(u: string) {
  return /^https?:\/\//.test(u) ? u : API_BASE + u;
}

function reasonLabel(reason: string) {
  const key = `mod_reason_${reason}`;
  const s = t2(key);
  return s === key ? reason : s;
}

export default function ModerationTab() {
  const [status, setStatus] = useState<ReportStatus>("open");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load(s: ReportStatus) {
    try {
      setReports((await api.reports(s)) || []);
    } catch (e: any) {
      setReports([]);
      setMessage(e?.message || t2("load_error"));
    }
  }

  useEffect(() => {
    setReports(null);
    setMessage("");
    load(status);
  }, [status]);

  async function resolve(r: Report, next: "dismissed" | "actioned", deleteMessage: boolean) {
    setBusyId(r.id);
    setMessage("");
    try {
      await api.resolveReport(r.id, { status: next, delete_message: deleteMessage });
      setMessage(t2("mod_resolved"));
      await load(status);
    } catch (e: any) {
      setMessage(e?.message || t2("save_error"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <h3>{t2("mod_title")}</h3>
      <div className="row">
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ReportStatus)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t2(`mod_status_${s}`)}</option>
          ))}
        </select>
        <button className="btn" onClick={() => { setMessage(""); load(status); }}>{t2("refresh")}</button>
      </div>
      <div className="muted">{t2("mod_hint")}</div>
      {message ? <div className="notice">{message}</div> : null}

      {reports === null ? (
        <div className="muted">{t2("loading")}</div>
      ) : reports.length === 0 ? (
        <div className="muted">{t2("mod_empty")}</div>
      ) : (
        <div className="list tall">
          {reports.map((r) => {
            const m = r.message;
            return (
              <div key={r.id} className="listItem static">
                <div className="title">
                  {reasonLabel(r.reason)} <span className="meta">#{r.id}</span>
                </div>
                <div className="meta">
                  {t2("mod_reported_by", { name: r.reporter?.display_name || t2("mod_unknown_user"), date: fmtDateTime(r.created_at) })}
                </div>
                {r.details ? <div className="meta">{t2("mod_details", { text: r.details })}</div> : null}

                {!m ? (
                  <div className="quote"><div className="meta">{t2("mod_message_missing")}</div></div>
                ) : (
                  <div className="quote">
                    <div className="meta">
                      {m.sender?.display_name || t2("mod_unknown_user")} · {fmtDateTime(m.created_at)} · {t2("mod_conversation", { id: m.conversation_id })}
                    </div>
                    {m.deleted ? (
                      <>
                        <span className="pill warn">{t2("mod_message_deleted")}</span>
                        {m.original_body != null ? (
                          <>
                            <div className="label">{t2("mod_original_body")}</div>
                            <div className="body removed">{m.original_body || t2("mod_no_text")}</div>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <div className="body">{m.body || t2("mod_no_text")}</div>
                    )}
                    {m.attachments?.length ? (
                      <div className="thumbs">
                        <span className="meta">{t2("mod_attachments")}:</span>
                        {m.attachments.map((a) => (
                          <a key={a.id} href={absUrl(a.url)} target="_blank" rel="noreferrer">
                            {a.thumb_url ? <img src={absUrl(a.thumb_url)} alt={a.file_name} /> : a.file_name}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}

                {r.status === "open" ? (
                  <div className="row">
                    <button className="btn" disabled={busyId === r.id} onClick={() => resolve(r, "dismissed", false)}>
                      {t2("mod_dismiss")}
                    </button>
                    {m && !m.deleted ? (
                      <button className="btn danger" disabled={busyId === r.id} onClick={() => resolve(r, "actioned", true)}>
                        {t2("mod_delete_message")}
                      </button>
                    ) : (
                      <button className="btn" disabled={busyId === r.id} onClick={() => resolve(r, "actioned", false)}>
                        {t2("mod_mark_actioned")}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
