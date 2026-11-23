import { useEffect, useState } from "react";
import { api, type PromoCode, type PromoCodeIn } from "./api";
import { fmtDay, madridYmd, t2 } from "./strings";

const DURATIONS = ["1m", "3m", "6m", "1y", "life"] as const;
type Duration = (typeof DURATIONS)[number] | "date";

type Form = {
  code: string;
  aliases: string;
  duration: Duration;
  date: string; // end day when duration is "date"
  max: string;
  public: boolean;
  expires_on: string;
};

const EMPTY: Form = { code: "", aliases: "", duration: "1y", date: "", max: "", public: false, expires_on: "" };

function durationLabel(d: string) {
  return (DURATIONS as readonly string[]).includes(d) ? t2(`duration_${d}`) : t2("duration_until", { date: fmtDay(d) });
}

function toForm(p: PromoCode): Form {
  const known = (DURATIONS as readonly string[]).includes(p.duration);
  return {
    code: p.code,
    aliases: (p.aliases || []).join(", "),
    duration: known ? (p.duration as Duration) : "date",
    date: known ? "" : p.duration,
    max: p.max == null ? "" : String(p.max),
    public: !!p.public,
    expires_on: p.expires_on || "",
  };
}

export default function PromoCodesTab() {
  const [codes, setCodes] = useState<PromoCode[] | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [listMessage, setListMessage] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setCodes((await api.promoCodes()) || []);
    } catch (e: any) {
      setCodes([]);
      setListMessage(e?.message || t2("load_error"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setEditing(null);
    setForm(EMPTY);
    setFormMessage("");
  }

  async function save() {
    setFormMessage("");
    const code = form.code.trim();
    const aliases = form.aliases.split(",").map((a) => a.trim()).filter(Boolean);
    const max = form.max.trim();
    if (code.length < 2) return setFormMessage(t2("codes_code_required"));
    if (aliases.length > 10) return setFormMessage(t2("codes_too_many_aliases"));
    if (max && !(Number.isInteger(Number(max)) && Number(max) >= 1)) return setFormMessage(t2("codes_max_invalid"));
    if (form.duration === "date" && !form.date) return setFormMessage(t2("codes_date_required"));
    const payload: PromoCodeIn = {
      code,
      aliases,
      duration: form.duration === "date" ? form.date : form.duration,
      max_uses: max ? Number(max) : null,
      public: form.public,
      expires_on: form.expires_on || null,
    };
    setBusy(true);
    try {
      const saved = await api.savePromoCode(payload);
      setEditing(saved.code);
      setForm(toForm(saved));
      setFormMessage(t2("codes_saved"));
      await load();
    } catch (e: any) {
      setFormMessage(e?.message || t2("save_error"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(code: string) {
    setListMessage("");
    setBusy(true);
    try {
      await api.deletePromoCode(code);
      setConfirmDelete(null);
      if (editing === code) startNew();
      setListMessage(t2("codes_deleted"));
      await load();
    } catch (e: any) {
      setListMessage(e?.message || t2("save_error"));
    } finally {
      setBusy(false);
    }
  }

  const today = madridYmd();

  return (
    <div className="grid">
      <div className="card">
        <h3>{t2("codes_title")}</h3>
        <div className="muted">{t2("codes_hint")}</div>
        {listMessage ? <div className="notice">{listMessage}</div> : null}
        {codes === null ? (
          <div className="muted">{t2("loading")}</div>
        ) : codes.length === 0 ? (
          <div className="muted">{t2("codes_empty")}</div>
        ) : (
          <div className="list">
            {codes.map((p) => {
              const pct = p.max ? Math.min(100, Math.round((p.used / p.max) * 100)) : 0;
              const expired = !!p.expires_on && p.expires_on < today;
              return (
                <div key={p.code} className={"listItem static" + (editing === p.code ? " active" : "")}>
                  <div className="title">
                    {p.code}
                    <span className={"pill" + (p.public ? " ok" : "")}>{p.public ? t2("codes_public") : t2("codes_private")}</span>
                  </div>
                  {p.aliases?.length ? <div className="meta">{t2("codes_aliases", { list: p.aliases.join(", ") })}</div> : null}
                  <div className="meta">{t2("codes_duration", { duration: durationLabel(p.duration) })}</div>
                  <div className="meta">
                    {p.expires_on
                      ? t2(expired ? "codes_expired" : "codes_expires", { date: fmtDay(p.expires_on) })
                      : t2("codes_no_expiry")}
                  </div>
                  <div className="meta">
                    {p.max == null
                      ? t2("codes_used_unlimited", { used: p.used })
                      : t2("codes_used", { used: p.used, max: p.max, left: p.left ?? Math.max(p.max - p.used, 0) })}
                  </div>
                  {p.max != null ? (
                    <div className={"progress" + (pct >= 100 ? " full" : "")}>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                  {confirmDelete === p.code ? (
                    <div className="row">
                      <span className="meta">{t2("codes_delete_confirm", { code: p.code })}</span>
                      <button className="btn danger" disabled={busy} onClick={() => remove(p.code)}>{t2("codes_delete_yes")}</button>
                      <button className="btn" onClick={() => setConfirmDelete(null)}>{t2("cancel")}</button>
                    </div>
                  ) : (
                    <div className="row">
                      <button
                        className="btn"
                        onClick={() => {
                          setEditing(p.code);
                          setForm(toForm(p));
                          setFormMessage("");
                        }}
                      >
                        {t2("codes_edit")}
                      </button>
                      <button className="btn danger" onClick={() => setConfirmDelete(p.code)}>{t2("codes_delete")}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0, flex: 1 }}>{editing ? t2("codes_form_edit", { code: editing }) : t2("codes_form_new")}</h3>
          {editing ? <button className="btn" onClick={startNew}>{t2("codes_new")}</button> : null}
        </div>
        <label className="label">{t2("codes_code")}</label>
        <input
          className="input"
          placeholder="LANZAMIENTO"
          readOnly={!!editing}
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
        />
        <label className="label">{t2("codes_aliases_input")}</label>
        <input className="input" placeholder="MEETGO50" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
        <label className="label">{t2("codes_duration_label")}</label>
        <div className="row">
          <select className="input" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value as Duration })}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>{t2(`duration_${d}`)}</option>
            ))}
            <option value="date">{t2("duration_date")}</option>
          </select>
          {form.duration === "date" ? (
            <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          ) : null}
        </div>
        <label className="label">{t2("codes_max")}</label>
        <input className="input" type="number" min={1} value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} />
        <label className="label">{t2("codes_expires_label")}</label>
        <input className="input" type="date" value={form.expires_on} onChange={(e) => setForm({ ...form, expires_on: e.target.value })} />
        <label className="checkbox">
          <input type="checkbox" checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} />
          {t2("codes_public_label")}
        </label>
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={save}>{t2("codes_save")}</button>
        </div>
        {formMessage ? <div className="notice">{formMessage}</div> : null}
      </div>
    </div>
  );
}
