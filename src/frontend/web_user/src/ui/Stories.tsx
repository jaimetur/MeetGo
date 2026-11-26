/** Stories of 24 hours (Inicio, on top): the strip of people with stories (mine first, a coloured ring while there is
 * something unseen), making one (a photo, a short video or a text on a colour; who sees it, and people it is hidden
 * from), and the viewer: full screen, one after another, tap to go on or back, hold to pause; reactions and a reply
 * (it reaches the author as a direct message); for mine, who saw them and deleting. */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@lang";
import { api, fileUrl } from "../api";
import { navigate } from "../router";
import { toast, useStore } from "../store";
import type { MusicTrack, StoryGroup, StoryItem, StoryLayout, UserSummary } from "../types";
import { DEFAULT_TEXT, FILTERS, FONTS, MUSIC_SECONDS, MusicPicker, STICKER_GROUPS, STICKER_MAX, StoryCanvas, TEXT_BGS, TEXT_COLORS, TEXT_MAX } from "./StoryCanvas";
import { shortWhen } from "../util";
import { Avatar, Icon, Modal, QUICK_REACTIONS } from "./common";

const PHOTO_MS = 5000;
const BACKGROUNDS = ["#7c3aed", "#2563eb", "#0d9488", "#16a34a", "#ea580c", "#dc2626", "#db2777", "#111827"];

export function StoriesBar() {
  const me = useStore((s) => s.me);
  const [groups, setGroups] = useState<StoryGroup[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);  // index of the group being watched
  const load = () => api.stories().then(setGroups).catch(() => setGroups([]));
  useEffect(() => { load(); }, []);
  if (!me) return null;
  const mine = groups?.find((g) => g.mine);
  const others = (groups || []).filter((g) => !g.mine);
  const ordered = [...(mine ? [mine] : []), ...others];
  return (
    <div className="stbar" aria-label={t("ui_stories")}>
      <div className="stitem">
        <button id="story-mine" type="button" className={"stcircle" + (mine ? " ring" : "")} onClick={() => (mine ? setOpen(0) : setCreating(true))}>
          <Avatar user={me} size={58} />
        </button>
        <button id="story-new" type="button" className="stplus" onClick={() => setCreating(true)} aria-label={t("ui_story_new")}><Icon name="plus" size="sm" /></button>
        <span className="stname">{t("ui_story_yours")}</span>
      </div>
      {others.map((g) => (
        <div key={g.user.id} className="stitem">
          <button type="button" className={"stcircle ring" + (g.all_seen ? " seen" : "")} onClick={() => setOpen(ordered.indexOf(g))}>
            <Avatar user={g.user} size={58} />
          </button>
          <span className="stname">{g.user.display_name}</span>
        </div>
      ))}
      {creating ? <StoryCreator onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} /> : null}
      {open !== null && ordered[open] ? (
        <StoryViewer groups={ordered} start={open} onClose={() => { setOpen(null); load(); }} onChanged={load} />
      ) : null}
    </div>
  );
}

// ---------- making one ----------

function StoryCreator({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"media" | "text">("media");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [text, setText] = useState("");
  const [bg, setBg] = useState(BACKGROUNDS[0]);
  const [layout, setLayout] = useState<StoryLayout>({ text: { ...DEFAULT_TEXT }, stickers: [], filter: "none" });
  const [selected, setSelected] = useState<number | "text" | null>(null);
  const [tool, setTool] = useState<"text" | "stickers" | "filters" | null>("text");
  const [group, setGroup] = useState("faces");
  const [music, setMusic] = useState<{ track: MusicTrack; start: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [audience, setAudience] = useState("friends");
  const [hidden, setHidden] = useState<number[]>([]);
  const [hiding, setHiding] = useState(false);
  const [friends, setFriends] = useState<UserSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => { if (hiding && !friends) api.friends().then(setFriends).catch(() => setFriends([])); }, [hiding]);
  const video = !!file && file.type.startsWith("video/");
  const tx = { ...DEFAULT_TEXT, ...(layout.text || {}) };
  const setText2 = (patch: Partial<typeof tx>) => setLayout((l) => ({ ...l, text: { ...tx, ...patch } }));
  const sel = typeof selected === "number" ? layout.stickers?.[selected] : null;
  async function publish() {
    setBusy(true);
    try {
      const common = { text: text.trim(), audience, hidden_from: hidden, layout, music: !music ? null : music.track.source === "deezer" ? { source: "deezer", deezer_id: music.track.deezer_id, start: music.start } : { id: music.track.id, start: music.start } };
      if (kind === "media") {
        if (!file) return;
        if (video && (await duration(preview)) > 16) throw new Error(t("ui_story_video_long"));
        const a = await api.upload(file);
        await api.storyCreate({ ...common, kind: video ? "video" : "photo", attachment_id: a.id });
      } else {
        await api.storyCreate({ ...common, kind: "text", bg });
      }
      toast(t("ui_story_posted"));
      onDone();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide title={t("ui_story_new")} onClose={onClose} footer={(
      <>
        <select id="story-audience" className="inp faud" value={audience} onChange={(e) => setAudience(e.target.value)} aria-label={t("ui_feed_audience")}>
          {["friends", "followers", "public"].map((a) => <option key={a} value={a}>{t(`ui_feed_aud_${a}`)}</option>)}
        </select>
        <span className="grow" />
        <button className="btn" onClick={onClose}>{t("ui_cancel")}</button>
        <button id="story-publish" className="btn pri" disabled={busy || (kind === "media" ? !file : !text.trim())} onClick={publish}>{busy ? t("ui_uploading") : t("ui_feed_publish")}</button>
      </>
    )}>
      <div className="stedit">
        <div className="stedit-canvas">
          <div className="segtabs stkind" role="tablist">
            <button role="tab" className={kind === "media" ? "on" : ""} onClick={() => setKind("media")}><Icon name="image" size="sm" /> {t("ui_story_kind_media")}</button>
            <button id="story-kind-text" role="tab" className={kind === "text" ? "on" : ""} onClick={() => setKind("text")}><Icon name="edit" size="sm" /> {t("ui_story_kind_text")}</button>
          </div>
          {kind === "media" && !file ? (
            <div className="stpreview" onClick={() => input.current?.click()}>
              <button type="button" className="btn"><Icon name="image" size="sm" />{t("ui_story_pick")}</button>
            </div>
          ) : (
            <div className="stpreview">
              <StoryCanvas kind={kind === "text" ? "text" : video ? "video" : "photo"} text={text} bg={bg} mediaUrl={preview} video={video}
                layout={layout} editable onLayout={setLayout} selected={selected} onSelect={setSelected} />
            </div>
          )}
          {music ? <div className="stmusic-chip"><Icon name="music" size="sm" /><span>{music.track.title} · {music.track.artist}</span></div> : null}
          <input ref={input} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setFile(f); }} />
        </div>
        <div className="stedit-tools">
          <textarea id="story-text" className="inp" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={kind === "text" ? t("ui_story_text_ph") : t("ui_story_caption_ph")} />
          <small className="muted">{t("ui_story_drag_hint")}</small>
          <div className="sttools">
            <button type="button" className={"chip" + (tool === "text" ? " on" : "")} onClick={() => setTool(tool === "text" ? null : "text")}><Icon name="edit" size="sm" />{t("ui_story_tool_text")}</button>
            <button id="story-tool-stickers" type="button" className={"chip" + (tool === "stickers" ? " on" : "")} onClick={() => setTool(tool === "stickers" ? null : "stickers")}><Icon name="smile" size="sm" />{t("ui_story_tool_stickers")}</button>
            {kind === "media" && file ? <button type="button" className={"chip" + (tool === "filters" ? " on" : "")} onClick={() => setTool(tool === "filters" ? null : "filters")}><Icon name="image" size="sm" />{t("ui_story_tool_filters")}</button> : null}
            <button id="story-tool-music" type="button" className={"chip" + (music ? " on" : "")} onClick={() => setPicking(true)}><Icon name="music" size="sm" />{t("ui_story_tool_music")}</button>
          </div>
          {tool === "text" ? (
            <div className="stpanel">
              <div className="stfonts">{FONTS.map((f) => <button key={f} type="button" className={`chip f-${f}` + (tx.font === f ? " on" : "")} onClick={() => setText2({ font: f })}>{t(`ui_story_font_${f}`)}</button>)}</div>
              <div className="stswatches">{TEXT_COLORS.map((c) => <button key={c} type="button" className={tx.color === c ? "on" : ""} style={{ background: c }} onClick={() => setText2({ color: c })} aria-label={c} />)}</div>
              <div className="strow">
                {TEXT_BGS.map((b) => <button key={b} type="button" className={"chip" + (tx.bg === b ? " on" : "")} onClick={() => setText2({ bg: b })}>{t(`ui_story_bg_${b}`)}</button>)}
                {(["left", "center", "right"] as const).map((al) => <button key={al} type="button" className={"chip" + (tx.align === al ? " on" : "")} onClick={() => setText2({ align: al })}>{t(`ui_story_align_${al}`)}</button>)}
              </div>
              <label className="strange">{t("ui_story_size")}<input type="range" min={14} max={TEXT_MAX} value={tx.size} onChange={(e) => setText2({ size: Number(e.target.value) })} /></label>
            </div>
          ) : null}
          {tool === "stickers" ? (
            <div className="stpanel">
              <div className="chips mtags mlists">
                {STICKER_GROUPS.map(([k]) => <button key={k} type="button" className={"chip" + (group === k ? " on" : "")} onClick={() => setGroup(k)}>{t(`ui_sticker_${k}`)}</button>)}
              </div>
              <div className="ststickers">{(STICKER_GROUPS.find(([k]) => k === group)?.[1] || []).map((e) => (
                <button key={e} type="button" onClick={() => { const list = [...(layout.stickers || []), { e, x: 0.5, y: 0.35, size: 56 }].slice(0, 12); setLayout({ ...layout, stickers: list }); setSelected(list.length - 1); }}>{e}</button>
              ))}</div>
              {sel ? (
                <div className="strow">
                  <label className="strange grow">{t("ui_story_size")}<input type="range" min={24} max={STICKER_MAX} value={sel.size}
                    onChange={(e) => setLayout({ ...layout, stickers: layout.stickers!.map((s, i) => (i === selected ? { ...s, size: Number(e.target.value) } : s)) })} /></label>
                  <button type="button" className="btn sm danger" onClick={() => { setLayout({ ...layout, stickers: layout.stickers!.filter((_, i) => i !== selected) }); setSelected(null); }}><Icon name="trash" size="sm" />{t("ui_remove")}</button>
                </div>
              ) : <small className="muted">{t("ui_story_sticker_hint")}</small>}
            </div>
          ) : null}
          {tool === "filters" && file ? (
            <div className="stpanel stfilters">
              {FILTERS.map(([k, css]) => (
                <button key={k} type="button" className={layout.filter === k ? "on" : ""} onClick={() => setLayout({ ...layout, filter: k })}>
                  {video ? <span className="stfthumb" style={{ background: "#333", filter: css }} /> : <img src={preview} alt="" style={{ filter: css }} />}
                  <small>{t(`ui_story_filter_${k}`)}</small>
                </button>
              ))}
            </div>
          ) : null}
          {kind === "text" ? (
            <div className="stcolors">
              {BACKGROUNDS.map((c) => <button key={c} type="button" className={bg === c ? "on" : ""} style={{ background: c }} onClick={() => setBg(c)} aria-label={c} />)}
            </div>
          ) : file ? <button type="button" className="linkbtn" onClick={() => input.current?.click()}>{t("ui_story_change")}</button> : null}
          <button type="button" className="linkbtn sthide-toggle" onClick={() => setHiding(!hiding)}>
            {hidden.length ? t("ui_story_hidden_n", { n: hidden.length }) : t("ui_story_hide_from")}
          </button>
          {hiding ? (
            <div className="sthide">
              {friends === null ? <span className="muted">{t("ui_loading")}</span> : friends.length === 0 ? <span className="muted">{t("ui_story_no_friends")}</span>
                : friends.map((f) => (
                  <label key={f.id} className="sthide-row">
                    <input type="checkbox" checked={hidden.includes(f.id)} onChange={(e) => setHidden((h) => (e.target.checked ? [...h, f.id] : h.filter((x) => x !== f.id)))} />
                    <Avatar user={f} size={28} /><span>{f.display_name}</span>
                  </label>
                ))}
            </div>
          ) : null}
        </div>
      </div>
      {/* a window of its own (on top of this one, not inside it: it would be cut) */}
      {picking ? createPortal(<MusicPicker value={music} onClose={() => setPicking(false)} onPick={(v) => { setMusic(v); setPicking(false); }} />, document.body) : null}
    </Modal>
  );
}

function duration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve(v.duration || 0);
    v.onerror = () => resolve(0);
    v.src = url;
  });
}

// ---------- watching ----------

function StoryViewer({ groups, start, onClose, onChanged }: { groups: StoryGroup[]; start: number; onClose: () => void; onChanged: () => void }) {
  const [g, setG] = useState(start);
  const group = groups[g];
  // each person's first unseen story (or the first one)
  const firstOf = (grp: StoryGroup) => Math.max(0, grp.stories.findIndex((s) => !s.seen));
  const [i, setI] = useState(() => firstOf(groups[start]));
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState("");
  const [viewers, setViewers] = useState<{ user: UserSummary; reaction: string | null }[] | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const story: StoryItem | undefined = group?.stories[i];
  // a story with a song lasts as long as its excerpt; without one, PHOTO_MS
  const lasts = story?.music ? MUSIC_SECONDS * 1000 : PHOTO_MS;

  const next = () => {
    if (i + 1 < group.stories.length) { setI(i + 1); return; }
    if (g + 1 < groups.length) { setG(g + 1); setI(firstOf(groups[g + 1])); return; }
    onClose();
  };
  const prev = () => {
    if (i > 0) { setI(i - 1); return; }
    if (g > 0) { setG(g - 1); setI(0); }
  };
  // seen as soon as it shows
  useEffect(() => {
    if (!story) return;
    setProgress(0); setSent(null); setReply("");
    if (!group.mine && !story.seen) { story.seen = true; api.storyView(story.id).catch(() => undefined); }
  }, [story?.id]);
  // photos and texts last PHOTO_MS; videos, their own length
  useEffect(() => {
    if (!story || paused || viewers || reply) return;
    if (story.kind === "video") return;
    const startAt = Date.now() - progress * lasts;
    const timer = window.setInterval(() => {
      const p = (Date.now() - startAt) / lasts;
      if (p >= 1) { window.clearInterval(timer); next(); } else setProgress(p);
    }, 50);
    return () => window.clearInterval(timer);
  }, [story?.id, paused, viewers, reply]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (paused || viewers || reply) v.pause(); else void v.play().catch(() => undefined);
  }, [paused, viewers, reply, story?.id]);
  // its song, from where its author chose
  useEffect(() => {
    if (!story?.music) return;
    const a = new Audio(fileUrl(story.music.url));
    a.currentTime = story.music.start;
    audio.current = a;
    void a.play().catch(() => undefined);
    return () => { a.pause(); audio.current = null; };
  }, [story?.id]);
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.muted = muted;
    if (paused || viewers || reply) a.pause(); else void a.play().catch(() => undefined);
  }, [paused, viewers, reply, muted, story?.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!group || !story) return null;

  const react = (emoji: string) => {
    api.storyView(story.id, emoji).then(() => { story.my_reaction = emoji; setSent(emoji); }).catch((e) => toast(e.message, "error"));
  };
  const sendReply = () => {
    api.storyReply(story.id, reply.trim()).then((r) => { setReply(""); setSent("✓"); toast(t("ui_story_reply_sent")); void r; })
      .catch((e) => toast(e.message, "error"));
  };
  const remove = () => api.storyDelete(story.id).then(() => { toast(t("ui_story_deleted")); onChanged(); onClose(); }).catch((e) => toast(e.message, "error"));

  return (
    <div className="stview" role="dialog" aria-modal="true" aria-label={t("ui_stories")}>
      <div className="stframe">
        {/* the bars, who and the buttons, and the song: a band of their own above the story, never on it */}
        <div className="sthead">
        <div className="stbars">
          {group.stories.map((s, k) => <span key={s.id}><i style={{ width: `${k < i ? 100 : k === i ? progress * 100 : 0}%` }} /></span>)}
        </div>
        <div className="sttop">
          <button type="button" className="stwho" onClick={() => { onClose(); navigate(`/u/${group.user.id}`); }}>
            <Avatar user={group.user} size={34} /><b>{group.mine ? t("ui_story_yours") : group.user.display_name}</b><small>{shortWhen(story.created_at)}</small>
          </button>
          <span className="grow" />
          {story.music ? <button type="button" className="iconbtn" onClick={() => setMuted(!muted)} aria-label={muted ? t("ui_story_unmute") : t("ui_story_mute")}><Icon name={muted ? "mute" : "volume"} /></button> : null}
          <button type="button" className="iconbtn" onClick={() => setPaused(!paused)} aria-label={paused ? t("ui_story_play") : t("ui_story_pause")}><Icon name={paused ? "play" : "pause"} /></button>
          <button type="button" className="iconbtn" onClick={onClose} aria-label={t("ui_close")}><Icon name="x" /></button>
        </div>
        {story.music ? (
          <div className="stmusic-chip over">
            {story.music.cover ? <img src={story.music.cover} alt="" /> : <Icon name="music" size="sm" />}
            <span>{story.music.title} · {story.music.artist}</span>
            {story.music.source === "deezer" && story.music.link ? <a href={story.music.link} target="_blank" rel="noreferrer">{t("ui_music_on_deezer")}</a> : null}
          </div>
        ) : null}
        </div>
        <div className="stbody" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}>
          {/* the same 9:16 frame as when it was made, as big as fits: the text and emojis where they were put */}
          <div className="stfit">
          <StoryCanvas kind={story.kind} text={story.text} bg={story.bg} mediaUrl={story.media ? fileUrl(story.media.url) : null} video={story.kind === "video"}
            layout={story.layout || {}} videoRef={video} muted={!!story.music || muted} onVideoTime={(p) => !story.music && setProgress(p)} onVideoEnd={() => !story.music && next()} />
          </div>
          <button type="button" className="sttap left" onClick={prev} aria-label={t("ui_previous")} />
          <button type="button" className="sttap right" onClick={next} aria-label={t("ui_next")} />
        </div>
        {group.mine ? (
          <div className="stfoot">
            <button id="story-viewers" type="button" className="btn sm" onClick={() => api.storyViewers(story.id).then(setViewers).catch((e) => toast(e.message, "error"))}>
              <Icon name="eye" size="sm" />{t("ui_story_seen_by", { n: story.views ?? 0 })}
            </button>
            <span className="grow" />
            <button type="button" className="btn sm danger" onClick={remove}><Icon name="trash" size="sm" />{t("ui_delete")}</button>
          </div>
        ) : (
          <div className="stfoot">
            <div className="streact">
              {QUICK_REACTIONS.map((e) => <button key={e} type="button" className={story.my_reaction === e ? "on" : ""} onClick={() => react(e)}>{e}</button>)}
            </div>
            <div className="streply">
              <input id="story-reply" className="inp" maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("ui_story_reply_ph", { name: group.user.display_name })}
                onKeyDown={(e) => { if (e.key === "Enter" && reply.trim()) sendReply(); }} />
              <button type="button" className="iconbtn" disabled={!reply.trim()} onClick={sendReply} aria-label={t("ui_send")}><Icon name="send" /></button>
            </div>
            {sent ? <div className="stsent">{sent === "✓" ? t("ui_story_reply_sent") : t("ui_story_reacted", { emoji: sent })}</div> : null}
          </div>
        )}
      </div>
      {viewers ? (
        <Modal title={t("ui_story_viewers")} onClose={() => setViewers(null)}>
          {viewers.length === 0 ? <p className="muted">{t("ui_story_no_views")}</p> : (
            <div className="fwho-list">
              {viewers.map((v) => (
                <div key={v.user.id} className="fwho-row">
                  <Avatar user={v.user} size={34} /><span className="grow">{v.user.display_name}</span>{v.reaction ? <span className="femoji">{v.reaction}</span> : null}
                </div>
              ))}
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
