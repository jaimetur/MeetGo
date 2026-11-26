/** Everyone's wall (Inicio → My wall / My friends, someone's wall, a post): posting text with photos or a video for
 * friends, followers or everyone of the zone; reactions, comments with replies, sharing (to my wall, or by chat),
 * saving, editing, deleting and reporting. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@lang";
import { api, fileUrl } from "../api";
import { navigate } from "../router";
import { toast, useStore } from "../store";
import type { FeedComment, FeedMedia, FeedPost, UserSummary } from "../types";
import { shortWhen } from "../util";
import { EmptyState } from "./Board";
import { Avatar, Icon, Modal, QUICK_REACTIONS } from "./common";
import { RichText } from "./RichText";

const MAX_MEDIA = 10;
const AUDIENCES = ["friends", "followers", "public"] as const;
type Audience = (typeof AUDIENCES)[number];
const REASONS = ["child_safety", "spam", "harassment", "hate", "sexual", "violence", "other"];

export const wallPath = (userId: number) => `/u/${userId}`;
export const feedPostPath = (id: number) => `/f/${id}`;

/** A list of posts that loads more at the end, and follows the changes made in it. */
function useFeed(loader: (before?: number) => Promise<{ posts: FeedPost[]; more: boolean }>, key: unknown) {
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback((before?: number) => {
    setBusy(true);
    loader(before).then((r) => { setPosts((old) => (before && old ? [...old, ...r.posts] : r.posts)); setMore(r.more); })
      .catch((e) => { toast(e.message, "error"); setPosts((old) => old || []); })
      .finally(() => setBusy(false));
  }, [key]);
  useEffect(() => { setPosts(null); load(); }, [load]);
  return {
    posts, more, busy, load,
    put: (p: FeedPost) => setPosts((old) => (old ? old.map((x) => (x.id === p.id ? p : x)) : old)),
    add: (p: FeedPost) => setPosts((old) => [p, ...(old || [])]),
    drop: (id: number) => setPosts((old) => (old ? old.filter((x) => x.id !== id) : old)),
  };
}

function FeedList({ feed, empty }: { feed: ReturnType<typeof useFeed>; empty: React.ReactNode }) {
  if (feed.posts === null) return <div className="fcard skel"><span className="sk w60 h18" /><span className="sk w80" /></div>;
  if (!feed.posts.length) return <>{empty}</>;
  return (
    <div className="flist">
      {feed.posts.map((p) => <FeedCard key={p.id} post={p} onChange={feed.put} onRemove={feed.drop} onShared={feed.add} />)}
      {feed.more ? <button className="btn" disabled={feed.busy} onClick={() => feed.load(feed.posts![feed.posts!.length - 1].id)}>{t("ui_feed_more")}</button> : null}
    </div>
  );
}

// ---------- Inicio's tabs ----------

/** My wall: what I post (and share), with the box to post at the top; my saved posts a tap away. */
export function MyWall() {
  const me = useStore((s) => s.me);
  const [saved, setSaved] = useState(false);
  const feed = useFeed((before) => (saved ? api.feedSaved(before) : api.feedWall(me!.id, before)), `${me?.id}:${saved}`);
  if (!me) return null;
  return (
    <div className="fwrap">
      {!saved ? <FeedComposer onPosted={feed.add} /> : null}
      <div className="fbar">
        <button className={"chip" + (!saved ? " on" : "")} onClick={() => setSaved(false)}>{t("ui_feed_my_posts")}</button>
        <button id="feed-saved" className={"chip" + (saved ? " on" : "")} onClick={() => setSaved(true)}><Icon name="bookmark" size="sm" />{t("ui_feed_saved")}</button>
      </div>
      <FeedList feed={feed} empty={<EmptyState icon={saved ? "bookmark" : "edit"} title={saved ? t("ui_feed_saved_empty") : t("ui_feed_wall_empty")} body={saved ? "" : t("ui_feed_wall_empty_body")} />} />
    </div>
  );
}

/** My friends: what my friends and the people I follow post. */
export function FriendsFeed() {
  const feed = useFeed((before) => api.feedFriends(before), "friends");
  return (
    <div className="fwrap">
      <FeedList feed={feed} empty={<EmptyState icon="users" title={t("ui_feed_friends_empty")} body={t("ui_feed_friends_empty_body")} action={t("ui_feed_find_people")} onAction={() => navigate("/people")} />} />
    </div>
  );
}

/** Someone's wall: their posts I may see. */
export function WallPage({ id }: { id: number }) {
  const me = useStore((s) => s.me);
  const feed = useFeed((before) => api.feedWall(id, before), id);
  const author = feed.posts?.find((p) => p.author.id === id)?.author;
  return (
    <main className="screen">
      <div className="swrap">
        <header className="shead">
          <button className="iconbtn" onClick={() => history.back()} aria-label={t("ui_back")}><Icon name="back" /></button>
          {author ? <Avatar user={author} size={44} /> : null}
          <div className="grow"><h1>{id === me?.id ? t("ui_feed_tab_wall") : author ? t("ui_feed_wall_of", { name: author.display_name }) : t("ui_feed_wall")}</h1></div>
        </header>
        <div className="fwrap">
          {id === me?.id ? <FeedComposer onPosted={feed.add} /> : null}
          <FeedList feed={feed} empty={<EmptyState icon="edit" title={t("ui_feed_wall_empty_other")} body="" />} />
        </div>
      </div>
    </main>
  );
}

/** One post, with its comments open (from a notice or a link). */
export function FeedPostPage({ id }: { id: number }) {
  const [post, setPost] = useState<FeedPost | null | undefined>(undefined);
  useEffect(() => { api.feedPost(id).then(setPost).catch(() => setPost(null)); }, [id]);
  return (
    <main className="screen">
      <div className="swrap">
        <header className="shead">
          <button className="iconbtn" onClick={() => (history.length > 1 ? history.back() : navigate("/?tab=friends"))} aria-label={t("ui_back")}><Icon name="back" /></button>
          <h1 className="grow">{t("ui_feed_post")}</h1>
        </header>
        {post === undefined ? <div className="fcard skel"><span className="sk w60 h18" /></div>
          : post === null ? <EmptyState icon="info" title={t("err_feed_post_not_found")} body="" />
            : <FeedCard post={post} onChange={setPost} onRemove={() => navigate("/?tab=wall")} startOpen />}
      </div>
    </main>
  );
}

// ---------- posting ----------

function AudienceSelect({ value, onChange, id }: { value: Audience; onChange: (v: Audience) => void; id?: string }) {
  return (
    <select id={id} className="inp faud" value={value} onChange={(e) => onChange(e.target.value as Audience)} aria-label={t("ui_feed_audience")}>
      {AUDIENCES.map((a) => <option key={a} value={a}>{t(`ui_feed_aud_${a}`)}</option>)}
    </select>
  );
}

function FeedComposer({ onPosted }: { onPosted: (p: FeedPost) => void }) {
  const me = useStore((s) => s.me);
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<FeedMedia[]>([]);
  const [audience, setAudience] = useState<Audience>("friends");
  const [place, setPlace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  async function add(files: File[]) {
    const list = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    const room = MAX_MEDIA - media.length;
    if (list.length > room) toast(t("ui_feed_max_media", { n: MAX_MEDIA }), "error");
    for (const f of list.slice(0, room)) {
      setUploading((n) => n + 1);
      try {
        const a = await api.upload(f);
        setMedia((m) => [...m, a]);
      } catch (e: any) {
        toast(e.message, "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }
  async function publish() {
    setBusy(true);
    try {
      const p = await api.feedCreate({ body: body.trim(), audience, place: place?.trim() || null, attachment_ids: media.map((m) => m.id) });
      onPosted(p);
      setBody(""); setMedia([]); setPlace(null);
      toast(t("ui_feed_posted"));
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  if (!me) return null;
  return (
    <div className="fcard fcompose">
      <div className="fcompose-top">
        <Avatar user={me} size={40} />
        <textarea id="feed-body" className="inp" rows={3} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("ui_feed_compose_ph")} />
      </div>
      {media.length || uploading ? (
        <div className="fthumbs">
          {media.map((m) => (
            <div key={m.id} className="fthumb">
              {m.mime.startsWith("video/") ? <video src={fileUrl(m.url)} muted /> : <img src={fileUrl(m.thumb_url || m.url)} alt="" />}
              <button type="button" className="iconbtn" onClick={() => setMedia((x) => x.filter((y) => y.id !== m.id))} aria-label={t("ui_remove")}><Icon name="x" size="sm" /></button>
            </div>
          ))}
          {Array.from({ length: uploading }).map((_, i) => <div key={`u${i}`} className="fthumb loading"><span className="spinner" /></div>)}
        </div>
      ) : null}
      {place !== null ? (
        <div className="fplace"><Icon name="place" size="sm" /><input id="feed-place" className="inp" maxLength={120} value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t("ui_feed_place_ph")} autoFocus />
          <button type="button" className="iconbtn" onClick={() => setPlace(null)} aria-label={t("ui_remove")}><Icon name="x" size="sm" /></button></div>
      ) : null}
      <div className="fcompose-bar">
        <button id="feed-add-media" type="button" className="btn sm" onClick={() => input.current?.click()} disabled={media.length >= MAX_MEDIA}><Icon name="image" size="sm" />{t("ui_feed_add_media")}</button>
        {place === null ? <button type="button" className="btn sm" onClick={() => setPlace("")}><Icon name="place" size="sm" />{t("ui_feed_add_place")}</button> : null}
        <span className="grow" />
        <AudienceSelect id="feed-audience" value={audience} onChange={setAudience} />
        <button id="feed-publish" className="btn pri" disabled={busy || uploading > 0 || (!body.trim() && !media.length)} onClick={publish}>{t("ui_feed_publish")}</button>
      </div>
      <input ref={input} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ""; void add(f); }} />
    </div>
  );
}

// ---------- a post ----------

function MediaGrid({ media }: { media: FeedMedia[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!media.length) return null;
  return (
    <>
      <div className={`fmedia n${Math.min(media.length, 4)}`}>
        {media.slice(0, 4).map((m, i) => (
          <button key={m.id} type="button" className="fm" onClick={() => setOpen(i)}>
            {m.mime.startsWith("video/") ? <video src={fileUrl(m.url)} controls playsInline preload="metadata" onClick={(e) => e.stopPropagation()} />
              : <img src={fileUrl(m.thumb_url || m.url)} alt="" loading="lazy" />}
            {i === 3 && media.length > 4 ? <span className="fmore">+{media.length - 4}</span> : null}
          </button>
        ))}
      </div>
      {open !== null ? (
        <div className="flight" onClick={() => setOpen(null)} role="dialog" aria-modal="true">
          <button className="iconbtn flight-x" aria-label={t("ui_close")} onClick={() => setOpen(null)}><Icon name="x" /></button>
          {media.length > 1 ? <button className="iconbtn flight-prev" onClick={(e) => { e.stopPropagation(); setOpen((open + media.length - 1) % media.length); }} aria-label={t("ui_previous")}><Icon name="back" /></button> : null}
          {media[open].mime.startsWith("video/") ? <video src={fileUrl(media[open].url)} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
            : <img src={fileUrl(media[open].url)} alt="" onClick={(e) => e.stopPropagation()} />}
          {media.length > 1 ? <button className="iconbtn flight-next" onClick={(e) => { e.stopPropagation(); setOpen((open + 1) % media.length); }} aria-label={t("ui_next")}><Icon name="back" /></button> : null}
        </div>
      ) : null}
    </>
  );
}

function AuthorLine({ post, compact }: { post: FeedPost; compact?: boolean }) {
  return (
    <div className="fhead">
      <button type="button" className="fwho" onClick={() => navigate(wallPath(post.author.id))}>
        <Avatar user={post.author} size={compact ? 30 : 40} />
        <span className="fwho-txt">
          <b>{post.author.display_name}</b>
          <small className="muted">
            <span title={new Date(post.created_at).toLocaleString()}>{shortWhen(post.created_at)}</span>
            {post.edited ? ` · ${t("ui_feed_edited")}` : ""}
            {" · "}<span className="faud-ic" title={t(`ui_feed_aud_${post.audience}`)}><Icon name={post.audience === "public" ? "compass" : post.audience === "followers" ? "users" : "user"} size="sm" /></span>
            {post.place ? <> · <Icon name="place" size="sm" />{post.place}</> : null}
          </small>
        </span>
      </button>
    </div>
  );
}

function FeedCard({ post, onChange, onRemove, onShared, startOpen }: {
  post: FeedPost; onChange: (p: FeedPost) => void; onRemove: (id: number) => void; onShared?: (p: FeedPost) => void; startOpen?: boolean;
}) {
  const [showComments, setShowComments] = useState(!!startOpen);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sharing, setSharing] = useState<"wall" | "chat" | null>(null);
  const [shareMenu, setShareMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [who, setWho] = useState<{ user: UserSummary; emoji: string }[] | null>(null);
  const total = Object.values(post.reactions).reduce((a, b) => a + b, 0);
  const top = Object.entries(post.reactions).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e);
  const react = (emoji: string | null) => {
    setPicker(false);
    api.feedReact(post.id, emoji).then(onChange).catch((e) => toast(e.message, "error"));
  };
  const toggleSave = () => api.feedSave(post.id, !post.saved).then(() => { onChange({ ...post, saved: !post.saved }); toast(post.saved ? t("ui_feed_unsaved") : t("ui_feed_saved_toast")); }).catch((e) => toast(e.message, "error"));

  return (
    <article className="fcard fpost" id={`feed-post-${post.id}`}>
      <div className="fhead-row">
        <AuthorLine post={post} />
        <div className="fmenu-wrap">
          <button type="button" className="iconbtn" aria-label={t("ui_more")} onClick={() => setMenu(!menu)}><Icon name="more" /></button>
          {menu ? (
            <div className="fmenu" onMouseLeave={() => setMenu(false)}>
              {post.mine ? <button onClick={() => { setMenu(false); setEditing(true); }}><Icon name="edit" size="sm" />{t("ui_edit")}</button> : null}
              {post.mine ? <button className="danger" onClick={() => { setMenu(false); setConfirmDelete(true); }}><Icon name="trash" size="sm" />{t("ui_delete")}</button> : null}
              {!post.mine ? <button onClick={() => { setMenu(false); setReporting(true); }}><Icon name="flag" size="sm" />{t("ui_report")}</button> : null}
              <button onClick={() => { setMenu(false); navigator.clipboard?.writeText(`${location.origin}/app${feedPostPath(post.id)}`).then(() => toast(t("ui_copied"))).catch(() => undefined); }}><Icon name="link" size="sm" />{t("ui_copy_link")}</button>
            </div>
          ) : null}
        </div>
      </div>
      {post.body ? <RichText className="fbody" text={post.body} /> : null}
      <MediaGrid media={post.media} />
      {post.shared_from_id ? (
        post.shared ? (
          <button type="button" className="fshared" onClick={() => navigate(feedPostPath(post.shared!.id))}>
            <AuthorLine post={post.shared} compact />
            {post.shared.body ? <RichText className="fbody" text={post.shared.body} /> : null}
            <MediaGrid media={post.shared.media} />
          </button>
        ) : <div className="fshared gone muted">{t("ui_feed_shared_gone")}</div>
      ) : null}

      {total || post.comments || post.shares ? (
        <div className="fstats">
          {total ? <button type="button" className="linkbtn" onClick={() => api.feedReactions(post.id).then(setWho).catch(() => undefined)}>{top.join("")} {total}</button> : <span />}
          <span className="grow" />
          {post.comments ? <button type="button" className="linkbtn" onClick={() => setShowComments(true)}>{post.comments === 1 ? t("ui_feed_one_comment") : t("ui_feed_n_comments", { n: post.comments })}</button> : null}
          {post.shares ? <span className="muted">{post.shares === 1 ? t("ui_feed_one_share") : t("ui_feed_n_shares", { n: post.shares })}</span> : null}
        </div>
      ) : null}

      <div className="factions">
        <div className="freact-wrap">
          <button type="button" className={"fact" + (post.my_reaction ? " on" : "")} onClick={() => setPicker(!picker)}>
            {post.my_reaction ? <span className="femoji">{post.my_reaction}</span> : <Icon name="smile" size="sm" />}{t("ui_feed_react")}
          </button>
          {picker ? (
            <div className="fpicker" onMouseLeave={() => setPicker(false)}>
              {QUICK_REACTIONS.map((e) => <button key={e} type="button" className={post.my_reaction === e ? "on" : ""} onClick={() => react(post.my_reaction === e ? null : e)}>{e}</button>)}
            </div>
          ) : null}
        </div>
        <button type="button" className="fact" onClick={() => setShowComments(!showComments)}><Icon name="chat" size="sm" />{t("ui_feed_comment")}</button>
        <div className="freact-wrap">
          <button type="button" className="fact" onClick={() => setShareMenu(!shareMenu)}><Icon name="share" size="sm" />{t("ui_feed_share")}</button>
          {shareMenu ? (
            <div className="fmenu up" onMouseLeave={() => setShareMenu(false)}>
              <button onClick={() => { setShareMenu(false); setSharing("wall"); }}><Icon name="edit" size="sm" />{t("ui_feed_share_wall")}</button>
              <button onClick={() => { setShareMenu(false); setSharing("chat"); }}><Icon name="chat" size="sm" />{t("ui_feed_share_chat")}</button>
            </div>
          ) : null}
        </div>
        <button type="button" className={"fact" + (post.saved ? " on" : "")} onClick={toggleSave}><Icon name="bookmark" size="sm" />{post.saved ? t("ui_feed_saved_on") : t("ui_feed_save")}</button>
      </div>

      {showComments ? <Comments post={post} onCount={(n) => onChange({ ...post, comments: n })} /> : null}

      {sharing === "wall" ? <ShareToWall post={post} onClose={() => setSharing(null)} onDone={(p) => { setSharing(null); onShared?.(p); onChange({ ...post, shares: post.shares + 1 }); }} /> : null}
      {sharing === "chat" ? <ShareToChat post={post} onClose={() => setSharing(null)} /> : null}
      {editing ? <EditPost post={post} onClose={() => setEditing(false)} onSaved={(p) => { setEditing(false); onChange(p); }} /> : null}
      {reporting ? <ReportFeedPost id={post.id} onClose={() => setReporting(false)} /> : null}
      {confirmDelete ? (
        <Modal title={t("ui_feed_delete_title")} onClose={() => setConfirmDelete(false)} footer={(
          <>
            <button className="btn" onClick={() => setConfirmDelete(false)}>{t("ui_cancel")}</button>
            <button id="feed-delete-yes" className="btn dangerfill" onClick={() => api.feedDelete(post.id).then(() => { setConfirmDelete(false); onRemove(post.id); toast(t("ui_feed_deleted")); }).catch((e) => toast(e.message, "error"))}>{t("ui_delete")}</button>
          </>
        )}><p className="muted">{t("ui_feed_delete_body")}</p></Modal>
      ) : null}
      {who ? (
        <Modal title={t("ui_feed_reactions")} onClose={() => setWho(null)}>
          <div className="fwho-list">
            {who.map((r) => (
              <button key={r.user.id} type="button" className="fwho-row" onClick={() => { setWho(null); navigate(wallPath(r.user.id)); }}>
                <Avatar user={r.user} size={34} /><span className="grow">{r.user.display_name}</span><span className="femoji">{r.emoji}</span>
              </button>
            ))}
          </div>
        </Modal>
      ) : null}
    </article>
  );
}

function Comments({ post, onCount }: { post: FeedPost; onCount: (n: number) => void }) {
  const [list, setList] = useState<FeedComment[] | null>(null);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<FeedComment | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.feedComments(post.id).then(setList).catch(() => setList([])); }, [post.id]);
  const send = () => {
    setBusy(true);
    api.feedComment(post.id, body.trim(), replyTo?.id).then((c) => {
      const next = [...(list || []), c];
      setList(next); onCount(next.length); setBody(""); setReplyTo(null);
    }).catch((e) => toast(e.message, "error")).finally(() => setBusy(false));
  };
  const remove = (c: FeedComment) => api.feedDeleteComment(c.id).then(() => {
    const next = (list || []).filter((x) => x.id !== c.id && x.parent_id !== c.id);
    setList(next); onCount(next.length);
  }).catch((e) => toast(e.message, "error"));
  const roots = (list || []).filter((c) => !c.parent_id);
  const row = (c: FeedComment) => (
    <div key={c.id} className={"fcomment" + (c.parent_id ? " reply" : "")}>
      <button type="button" className="fcav" onClick={() => navigate(wallPath(c.author.id))}><Avatar user={c.author} size={c.parent_id ? 26 : 30} /></button>
      <div className="fcbubble">
        <b>{c.author.display_name}</b>
        <RichText text={c.body} />
        <div className="fcmeta">
          <span className="muted">{shortWhen(c.created_at)}</span>
          <button type="button" className="linkbtn" onClick={() => { setReplyTo(c.parent_id ? (list || []).find((x) => x.id === c.parent_id) || c : c); setBody(`@${c.author.display_name} `); }}>{t("ui_feed_reply")}</button>
          {c.mine || post.mine ? <button type="button" className="linkbtn muted" onClick={() => remove(c)}>{t("ui_delete")}</button> : null}
        </div>
      </div>
    </div>
  );
  return (
    <div className="fcomments">
      {list === null ? <span className="muted">{t("ui_loading")}</span> : roots.map((c) => (
        <React.Fragment key={c.id}>
          {row(c)}
          {(list || []).filter((r) => r.parent_id === c.id).map(row)}
        </React.Fragment>
      ))}
      {replyTo ? <div className="fcreplying muted">{t("ui_feed_replying_to", { name: replyTo.author.display_name })} <button type="button" className="linkbtn" onClick={() => { setReplyTo(null); setBody(""); }}>{t("ui_cancel")}</button></div> : null}
      <div className="fcinput">
        <input id={`feed-comment-${post.id}`} className="inp" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("ui_feed_comment_ph")}
          onKeyDown={(e) => { if (e.key === "Enter" && body.trim() && !busy) send(); }} />
        <button type="button" className="btn pri sm" disabled={busy || !body.trim()} onClick={send}>{t("ui_send")}</button>
      </div>
    </div>
  );
}

function ShareToWall({ post, onClose, onDone }: { post: FeedPost; onClose: () => void; onDone: (p: FeedPost) => void }) {
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("friends");
  const [busy, setBusy] = useState(false);
  const origin = post.shared || post;
  return (
    <Modal title={t("ui_feed_share_wall")} onClose={onClose} footer={(
      <>
        <AudienceSelect value={audience} onChange={setAudience} />
        <span className="grow" />
        <button className="btn" onClick={onClose}>{t("ui_cancel")}</button>
        <button id="feed-share-yes" className="btn pri" disabled={busy} onClick={() => {
          setBusy(true);
          api.feedCreate({ body: body.trim(), audience, shared_from_id: origin.id }).then((p) => { toast(t("ui_feed_shared_toast")); onDone(p); })
            .catch((e) => toast(e.message, "error")).finally(() => setBusy(false));
        }}>{t("ui_feed_share")}</button>
      </>
    )}>
      <textarea id="feed-share-body" className="inp" rows={3} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("ui_feed_share_ph")} autoFocus />
      <div className="fshared static"><AuthorLine post={origin} compact />{origin.body ? <RichText className="fbody" text={origin.body} /> : null}</div>
    </Modal>
  );
}

/** Send a post to one of my chats, as a message with its link. */
function ShareToChat({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const conversations = useStore((s) => s.conversations);
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const plain = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const list = Object.values(conversations).filter((c) => !c.read_only && !c.archive && (!q || plain(c.title || "").includes(plain(q))))
    .sort((a, b) => (b.last_message_at || "").localeCompare(a.last_message_at || "")).slice(0, 30);
  const send = (convId: number) => {
    const link = `${location.origin}/app${feedPostPath(post.id)}`;
    const snippet = post.body ? `«${post.body.slice(0, 120)}${post.body.length > 120 ? "…" : ""}»` : "";
    const body = [note.trim(), t("ui_feed_chat_post_by", { name: post.author.display_name }) + (snippet ? ` ${snippet}` : ""), link].filter(Boolean).join("\n");
    api.send(convId, { body, client_id: `fs-${post.id}-${convId}-${Date.now()}` }).then(() => { toast(t("ui_feed_sent_chat")); onClose(); }).catch((e) => toast(e.message, "error"));
  };
  return (
    <Modal title={t("ui_feed_share_chat")} onClose={onClose}>
      <input id="feed-chat-note" className="inp" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ui_feed_chat_note_ph")} />
      <input className="inp" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_search_placeholder")} style={{ marginTop: 8 }} />
      <div className="fwho-list">
        {list.map((c) => (
          <button key={c.id} type="button" className="fwho-row" onClick={() => send(c.id)}>
            <Avatar user={c.other_user || { id: c.id, display_name: c.title, avatar_url: c.avatar_url }} size={34} />
            <span className="grow">{c.other_user?.display_name || c.title}</span><Icon name="send" size="sm" />
          </button>
        ))}
      </div>
    </Modal>
  );
}

function EditPost({ post, onClose, onSaved }: { post: FeedPost; onClose: () => void; onSaved: (p: FeedPost) => void }) {
  const [body, setBody] = useState(post.body);
  const [audience, setAudience] = useState<Audience>(post.audience);
  const [place, setPlace] = useState(post.place || "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={t("ui_feed_edit_title")} onClose={onClose} footer={(
      <>
        <AudienceSelect value={audience} onChange={setAudience} />
        <span className="grow" />
        <button className="btn" onClick={onClose}>{t("ui_cancel")}</button>
        <button className="btn pri" disabled={busy} onClick={() => {
          setBusy(true);
          api.feedEdit(post.id, { body, audience, place }).then((p) => { toast(t("ui_saved")); onSaved(p); }).catch((e) => toast(e.message, "error")).finally(() => setBusy(false));
        }}>{t("ui_save")}</button>
      </>
    )}>
      <textarea className="inp" rows={5} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="fplace" style={{ marginTop: 8 }}><Icon name="place" size="sm" /><input className="inp" maxLength={120} value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t("ui_feed_place_ph")} /></div>
    </Modal>
  );
}

function ReportFeedPost({ id, onClose }: { id: number; onClose: () => void }) {
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  return (
    <Modal title={t("ui_feed_report_title")} onClose={onClose} footer={(
      <>
        <button className="btn" onClick={onClose}>{t("ui_cancel")}</button>
        <button className="btn pri" onClick={() => api.feedReport(id, reason, details.trim() || undefined).then(() => { toast(t("ui_reported")); onClose(); }).catch((e) => toast(e.message, "error"))}>{t("ui_report")}</button>
      </>
    )}>
      <label className="fld">{t("ui_reason")}
        <select className="inp" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => <option key={r} value={r}>{t("ui_reason_" + r)}</option>)}
        </select>
      </label>
      <label className="fld">{t("ui_post_report_details")}<textarea className="inp" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
    </Modal>
  );
}

