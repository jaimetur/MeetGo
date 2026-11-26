/** Administration → Music: the songs stories can have. Famous works in free recordings and MeetGo's own music by mood
 * (built in: they can be hidden, not deleted), and songs uploaded here with their title, author and licence. */
import React, { useEffect, useRef, useState } from "react";
import { fileUrl } from "../../api";
import { api, type AdminTrack } from "../../../../web_admin/api";
import { toast } from "../../store";
import { Icon, Modal } from "../common";
import { MOODS } from "../StoryCanvas";
import { t } from "@lang";
import { SectionHead } from "./AdminPage";
import { a } from "./i18n";
import { Badge, Empty, Field, Switch } from "./kit";

export function Music() {
  const [list, setList] = useState<AdminTrack[] | null>(null);
  const [tab, setTab] = useState<"classic" | "mood">("classic");
  const [adding, setAdding] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const load = () => api.adminMusic().then(setList).catch((e) => { toast(e.message, "error"); setList([]); });
  useEffect(() => { load(); return () => audio.current?.pause(); }, []);
  const play = (m: AdminTrack) => {
    if (!audio.current) audio.current = new Audio();
    if (playing === m.id) { audio.current.pause(); setPlaying(null); return; }
    audio.current.src = fileUrl(m.url);
    audio.current.onended = () => setPlaying(null);
    void audio.current.play().then(() => setPlaying(m.id)).catch(() => setPlaying(null));
  };
  const shown = (list || []).filter((m) => m.kind === tab);
  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_music")} sub={list ? a("mu_count", { n: list.length }) : undefined}>
        <button id="adm-music-new" className="btn pri sm" onClick={() => setAdding(true)}><Icon name="plus" size="sm" />{a("mu_add")}</button>
      </SectionHead>
      <div className="segtabs" role="tablist">
        <button role="tab" className={tab === "classic" ? "on" : ""} onClick={() => setTab("classic")}>{t("ui_music_tab_classic")}</button>
        <button role="tab" className={tab === "mood" ? "on" : ""} onClick={() => setTab("mood")}>{t("ui_music_tab_mood")}</button>
      </div>
      {list === null ? <div className="adm-loading">{a("loading")}</div> : !shown.length ? <Empty icon="music" text={a("mu_empty")} /> : (
        <div className="mu-list">
          {shown.map((m) => (
            <div key={m.id} className={"mu-row" + (m.active ? "" : " dim")}>
              <button type="button" className="iconbtn mplay" onClick={() => play(m)} aria-label={a("mu_listen")}><Icon name={playing === m.id ? "pause" : "play"} size="sm" /></button>
              <div className="grow mu-txt">
                <b>{m.title}</b>
                <small className="muted">{m.artist}{m.performer ? ` · ${m.performer}` : ""}{m.mood ? ` · ${t(`ui_mood_${m.mood}`)}` : ""} · {m.duration} s</small>
                <span className="adm-tile-row">
                  {m.license ? <Badge tone="gray">{m.license}</Badge> : null}
                  {m.builtin ? <Badge tone="blue">MeetGo</Badge> : <Badge tone="teal">{a("mu_uploaded")}</Badge>}
                  {m.source_url ? <a className="linkbtn" href={m.source_url} target="_blank" rel="noreferrer">{a("mu_source")}</a> : null}
                </span>
              </div>
              <Switch id={`adm-music-${m.id}`} label={a("mu_active")} on={m.active} onChange={(v) => api.editMusic(m.id, { active: v }).then((x) => setList((l) => l!.map((y) => (y.id === x.id ? x : y)))).catch((e) => toast(e.message, "error"))} />
              {!m.builtin ? <button type="button" className="iconbtn" aria-label={a("mu_delete")} onClick={() => api.deleteMusic(m.id).then(() => { toast(a("mu_deleted")); load(); }).catch((e) => toast(e.message, "error"))}><Icon name="trash" size="sm" /></button> : null}
            </div>
          ))}
        </div>
      )}
      {adding ? <AddTrack kind={tab} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} /> : null}
    </div>
  );
}

function AddTrack({ kind: start, onClose, onDone }: { kind: "classic" | "mood"; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [kind, setKind] = useState(start);
  const [mood, setMood] = useState("happy");
  const [license, setLicense] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={a("mu_add")} onClose={onClose} footer={(
      <>
        <button className="btn" onClick={onClose}>{a("cancel")}</button>
        <button className="btn pri" disabled={busy || !file || !title.trim()} onClick={() => {
          setBusy(true);
          api.addMusic(file!, { title: title.trim(), artist: artist.trim(), kind, mood: kind === "mood" ? mood : undefined, license: license.trim(), source_url: source.trim() || undefined })
            .then(() => { toast(a("mu_added")); onDone(); }).catch((e) => toast(e.message, "error")).finally(() => setBusy(false));
        }}>{busy ? a("mu_uploading") : a("mu_add")}</button>
      </>
    )}>
      <p className="muted adm-note">{a("mu_add_hint")}</p>
      <Field label={a("mu_file")}><input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      <Field label={a("mu_title")}><input className="inp" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label={a("mu_artist")}><input className="inp" maxLength={160} value={artist} onChange={(e) => setArtist(e.target.value)} /></Field>
      <Field label={a("mu_kind")}>
        <select className="inp" value={kind} onChange={(e) => setKind(e.target.value as "classic" | "mood")}>
          <option value="classic">{t("ui_music_tab_classic")}</option><option value="mood">{t("ui_music_tab_mood")}</option>
        </select>
      </Field>
      {kind === "mood" ? (
        <Field label={a("mu_mood")}>
          <select className="inp" value={mood} onChange={(e) => setMood(e.target.value)}>{MOODS.map((m) => <option key={m} value={m}>{t(`ui_mood_${m}`)}</option>)}</select>
        </Field>
      ) : null}
      <Field label={a("mu_license")} hint={a("mu_license_hint")}><input className="inp" maxLength={64} value={license} onChange={(e) => setLicense(e.target.value)} placeholder="CC BY 4.0" /></Field>
      <Field label={a("mu_source_url")}><input className="inp" maxLength={400} value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://" /></Field>
    </Modal>
  );
}
