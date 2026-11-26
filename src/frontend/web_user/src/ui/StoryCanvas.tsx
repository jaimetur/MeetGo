/** A story as it is seen, also while making it: the photo, video or colour, the text where it was put with its style,
 * the emoji stickers and the filter. Editable: the text and the stickers are dragged with a finger or the mouse. And
 * the music picker: famous works (free recordings) and MeetGo's own music by mood, in two tabs. */
import React, { useEffect, useRef, useState } from "react";
import { t } from "@lang";
import { api, fileUrl } from "../api";
import { toast } from "../store";
import type { MusicTrack, StoryLayout } from "../types";
import { Icon, Modal } from "./common";

export const FONTS = ["classic", "bold", "typewriter", "neon", "hand"] as const;
export const TEXT_BGS = ["none", "solid", "soft"] as const;
export const FILTERS: [string, string][] = [
  ["none", "none"], ["bw", "grayscale(1)"], ["sepia", "sepia(.85)"], ["warm", "saturate(1.3) hue-rotate(-12deg) brightness(1.05)"],
  ["cool", "saturate(1.1) hue-rotate(15deg) brightness(1.02)"], ["vivid", "saturate(1.7) contrast(1.1)"], ["fade", "contrast(.8) brightness(1.15) saturate(.7)"],
];
export const TEXT_COLORS = ["#ffffff", "#111827", "#facc15", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#3b82f6", "#22c55e"];
export const STICKERS = ["😀", "😂", "😍", "🥳", "😎", "🔥", "❤️", "👍", "🎉", "✨", "🌞", "🌙", "🏖️", "🏔️", "⚽", "🎶", "🍕", "🍻", "☕", "📍"];
export const MUSIC_SECONDS = 15;

export const DEFAULT_TEXT = { x: 0.5, y: 0.5, size: 28, color: "#ffffff", font: "classic", bg: "none", align: "center" as const };

const filterCss = (f?: string) => FILTERS.find(([k]) => k === f)?.[1] || "none";
/** Black or white over a colour, whichever reads. */
const contrast = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? "#111827" : "#ffffff";
};

export function StoryCanvas({ kind, text, bg, mediaUrl, video, layout, editable, onLayout, selected, onSelect, videoRef, muted, onVideoTime, onVideoEnd }: {
  kind: "photo" | "video" | "text"; text: string; bg?: string | null; mediaUrl?: string | null; video?: boolean; layout: StoryLayout;
  editable?: boolean; onLayout?: (l: StoryLayout) => void; selected?: number | "text" | null; onSelect?: (s: number | "text" | null) => void;
  videoRef?: React.Ref<HTMLVideoElement>; muted?: boolean; onVideoTime?: (p: number) => void; onVideoEnd?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ what: number | "text"; dx: number; dy: number } | null>(null);
  const tx = { ...DEFAULT_TEXT, ...(layout.text || {}) };
  const where = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const start = (what: number | "text") => (e: React.PointerEvent) => {
    if (!editable) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = where(e);
    const at = what === "text" ? tx : layout.stickers![what];
    drag.current = { what, dx: p.x - at.x, dy: p.y - at.y };
    onSelect?.(what);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !onLayout) return;
    const p = where(e);
    const x = Math.min(0.98, Math.max(0.02, p.x - drag.current.dx));
    const y = Math.min(0.98, Math.max(0.02, p.y - drag.current.dy));
    if (drag.current.what === "text") onLayout({ ...layout, text: { ...tx, x, y } });
    else onLayout({ ...layout, stickers: layout.stickers!.map((s, i) => (i === drag.current!.what ? { ...s, x, y } : s)) });
  };
  const end = () => { drag.current = null; };
  const textStyle: React.CSSProperties = {
    left: `${tx.x * 100}%`, top: `${tx.y * 100}%`, fontSize: `calc(${tx.size} * 100cqw / 360)`, textAlign: tx.align,
    color: tx.bg === "solid" ? contrast(tx.color) : tx.color,
    background: tx.bg === "solid" ? tx.color : tx.bg === "soft" ? "rgba(0,0,0,.45)" : "transparent",
    ...(tx.font === "neon" ? { textShadow: `0 0 6px ${tx.color}, 0 0 16px ${tx.color}` } : {}),
  };
  return (
    <div ref={box} className={"stcanvas" + (editable ? " edit" : "")} style={kind === "text" ? { background: bg || "#7c3aed" } : undefined}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end} onClick={() => editable && onSelect?.(null)}>
      {kind === "photo" && mediaUrl ? <img src={mediaUrl} alt="" draggable={false} style={{ filter: filterCss(layout.filter) }} /> : null}
      {kind === "video" && mediaUrl ? (
        <video ref={videoRef} src={mediaUrl} autoPlay loop={editable} muted={muted ?? editable} playsInline style={{ filter: filterCss(layout.filter) }}
          onTimeUpdate={(e) => onVideoTime?.(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)} onEnded={onVideoEnd} />
      ) : null}
      {text ? (
        <div className={`sttxt f-${tx.font}${selected === "text" ? " sel" : ""}${tx.bg !== "none" ? " boxed" : ""}`} style={textStyle}
          onPointerDown={start("text")} onClick={(e) => e.stopPropagation()}>{text}</div>
      ) : null}
      {(layout.stickers || []).map((s, i) => (
        <div key={i} className={"ststicker" + (selected === i ? " sel" : "")} style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, fontSize: `calc(${s.size} * 100cqw / 360)` }}
          onPointerDown={start(i)} onClick={(e) => e.stopPropagation()}>{s.e}</div>
      ))}
    </div>
  );
}

// ---------- the music picker ----------

export const MOODS = ["happy", "chill", "romantic", "epic", "sad", "energetic", "mysterious", "party", "dreamy", "summer"];

export function MusicPicker({ value, onPick, onClose }: { value: { track: MusicTrack; start: number } | null; onPick: (v: { track: MusicTrack; start: number } | null) => void; onClose: () => void }) {
  const [tracks, setTracks] = useState<MusicTrack[] | null>(null);
  const [tab, setTab] = useState<"classic" | "mood">(value?.track.kind || "classic");
  const [mood, setMood] = useState("");
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState(value);
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number>(0);
  useEffect(() => { api.music().then(setTracks).catch((e) => { toast(e.message, "error"); setTracks([]); }); }, []);
  useEffect(() => () => { audio.current?.pause(); }, []);
  const play = (track: MusicTrack, from: number) => {
    if (!audio.current) audio.current = new Audio();
    const a = audio.current;
    if (playing === track.id && !a.paused && Math.abs(a.currentTime - from) < 0.5) { a.pause(); setPlaying(null); return; }
    a.src = fileUrl(track.url);
    a.currentTime = from;
    stopAt.current = from + MUSIC_SECONDS;
    a.ontimeupdate = () => { if (a.currentTime >= stopAt.current) { a.pause(); setPlaying(null); } };
    a.onended = () => setPlaying(null);
    void a.play().then(() => setPlaying(track.id)).catch(() => setPlaying(null));
  };
  const plain = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const list = (tracks || []).filter((m) => m.kind === tab && (!mood || m.mood === mood) && (!q || plain(`${m.title} ${m.artist}`).includes(plain(q))));
  return (
    <Modal wide title={t("ui_music_title")} onClose={() => { audio.current?.pause(); onClose(); }} footer={(
      <>
        {value ? <button className="btn danger" onClick={() => { audio.current?.pause(); onPick(null); }}>{t("ui_music_remove")}</button> : null}
        <span className="grow" />
        <button className="btn" onClick={() => { audio.current?.pause(); onClose(); }}>{t("ui_cancel")}</button>
        <button id="music-use" className="btn pri" disabled={!chosen} onClick={() => { audio.current?.pause(); onPick(chosen); }}>{t("ui_music_use")}</button>
      </>
    )}>
      <div className="segtabs" role="tablist">
        <button id="music-tab-classic" role="tab" className={tab === "classic" ? "on" : ""} onClick={() => setTab("classic")}>{t("ui_music_tab_classic")}</button>
        <button id="music-tab-mood" role="tab" className={tab === "mood" ? "on" : ""} onClick={() => setTab("mood")}>{t("ui_music_tab_mood")}</button>
      </div>
      {tab === "mood" ? (
        <div className="chips mtags">
          <button className={"chip" + (!mood ? " on" : "")} onClick={() => setMood("")}>{t("ui_music_all")}</button>
          {MOODS.map((m) => <button key={m} className={"chip" + (mood === m ? " on" : "")} onClick={() => setMood(m)}>{t(`ui_mood_${m}`)}</button>)}
        </div>
      ) : null}
      <input className="inp" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_music_search")} style={{ margin: "8px 0" }} />
      <div className="mlist">
        {tracks === null ? <span className="muted">{t("ui_loading")}</span> : !list.length ? <span className="muted">{t("ui_music_none")}</span> : list.map((m) => (
          <div key={m.id} className={"mrow" + (chosen?.track.id === m.id ? " on" : "")}>
            <button type="button" className="iconbtn mplay" onClick={() => play(m, chosen?.track.id === m.id ? chosen.start : 0)} aria-label={t("ui_music_listen")}>
              <Icon name={playing === m.id ? "pause" : "play"} size="sm" />
            </button>
            <button type="button" className="mtxt" onClick={() => setChosen({ track: m, start: chosen?.track.id === m.id ? chosen.start : 0 })}>
              <b>{m.title}</b><small className="muted">{m.artist}{m.kind === "mood" && m.mood ? ` · ${t(`ui_mood_${m.mood}`)}` : ""}</small>
            </button>
            {chosen?.track.id === m.id ? <Icon name="check2" /> : null}
          </div>
        ))}
      </div>
      {chosen ? (
        <div className="mstart">
          <span className="muted">{t("ui_music_from", { s: chosen.start })}</span>
          <input id="music-start" type="range" min={0} max={Math.max(0, chosen.track.duration - MUSIC_SECONDS)} value={chosen.start}
            onChange={(e) => setChosen({ ...chosen, start: Number(e.target.value) })} onMouseUp={() => play(chosen.track, chosen.start)} onTouchEnd={() => play(chosen.track, chosen.start)} />
          {chosen.track.license ? <small className="muted mlic">{t("ui_music_license", { license: chosen.track.license, performer: chosen.track.performer || chosen.track.artist })}</small> : null}
        </div>
      ) : null}
    </Modal>
  );
}
