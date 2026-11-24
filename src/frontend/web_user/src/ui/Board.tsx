// The board: home feed, post cards, the post page and the publish screen.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@lang";
import { api, fileUrl } from "../api";
import {
  type BoardEvent, coverGradient, dateTile, emitBoardEvent, eventPostId, fromLocalParts, hourOf, isDated, isPast, longWhen, onBoardEvent, relative,
  timeRange, toLocalParts,
} from "../board";
import { chatPath, communityPath, goBack, navigate, postPath } from "../router";
import { loadConversations, loadMyCommunities, refreshMyPlansSoon, setState, toast, useStore } from "../store";
import type { Attendee, Comment, Community, FeedFilter, Post, PostKind, PostPage as PostPageData } from "../types";
import { signOut } from "./App";
import { Avatar, Icon, Modal, Wordmark, useClickOutside, countryOptions } from "./common";

export const KIND_KEYS: Record<PostKind, string> = {
  meetup: "ui_post_kind_meetup", event: "ui_post_kind_event", notice: "ui_post_kind_notice", thread: "ui_post_kind_thread",
};
const KIND_ICONS: Record<PostKind, string> = { meetup: "users", event: "ticket", notice: "megaphone", thread: "chat" };

export const STAFF_ROLES = ["owner", "admin", "moderator"];

// ---------- small pieces ----------
export function KindTag({ kind }: { kind: PostKind }) {
  return <span className={"ktag k-" + kind}><Icon name={KIND_ICONS[kind]} size="sm" />{t(KIND_KEYS[kind])}</span>;
}

export function DateTile({ iso, big }: { iso: string; big?: boolean }) {
  const d = dateTile(iso);
  return (
    <div className={"dtile" + (big ? " big" : "")} aria-hidden="true">
      <small>{d.weekday}</small>
      <b>{d.day}</b>
      <i>{d.month}</i>
    </div>
  );
}

export function Faces({ users, max = 5, size = 26 }: { users: { id: number; display_name: string; avatar_url?: string | null }[]; max?: number; size?: number }) {
  if (!users.length) return null;
  return (
    <span className="faces">
      {users.slice(0, max).map((u) => <Avatar key={u.id} user={u} size={size} />)}
    </span>
  );
}

function PlacesBar({ post }: { post: Post }) {
  if (!post.capacity) return null;
  const pct = Math.min(100, Math.round((post.going_count / post.capacity) * 100));
  return <div className={"pbar" + (pct >= 100 ? " full" : "")} aria-hidden="true"><i style={{ width: pct + "%" }} /></div>;
}

export function placesText(post: Post) {
  if (post.capacity) {
    const free = Math.max(0, post.capacity - post.going_count);
    return free > 0 ? t("ui_post_places_of", { n: post.going_count, total: post.capacity }) : t("ui_post_full");
  }
  return t("ui_post_going_n", { n: post.going_count });
}

export function Skeletons({ n = 3 }: { n?: number }) {
  return (
    <div className="plist2" aria-busy="true" aria-label={t("ui_loading")}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="pcard skel">
          <div className="pcover shimmer" />
          <div className="pbody">
            <span className="sk w30" /><span className="sk w80 h18" /><span className="sk w60" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action, onAction, secondary, onSecondary }: {
  icon: string; title: string; body?: string; action?: string; onAction?: () => void; secondary?: string; onSecondary?: () => void;
}) {
  return (
    <div className="bempty">
      <div className="bempty-ic"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        {action ? <button className="btn go" onClick={onAction}>{action}</button> : null}
        {secondary ? <button className="btn" onClick={onSecondary}>{secondary}</button> : null}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, body, confirm, danger, onConfirm, onClose }: {
  title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => Promise<unknown> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={(
      <>
        <button className="btn" onClick={onClose}>{t("ui_cancel")}</button>
        <button className={"btn " + (danger ? "dangerfill" : "pri")} disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
            onClose();
          } finally {
            setBusy(false);
          }
        }}>{confirm}</button>
      </>
    )}>
      <p style={{ margin: 0 }}>{body}</p>
    </Modal>
  );
}

// ---------- signing up ----------
/** Sign up for a plan; every list showing it gets the new state at once. */
export async function attendPost(post: Post, meUser?: { id: number; display_name: string; avatar_url?: string | null } | null) {
  try {
    const { status } = await api.attend(post.id);
    const next: Post = {
      ...post, my_status: status,
      going_count: post.going_count + (status === "going" ? 1 : 0),
      waitlist_count: post.waitlist_count + (status === "waitlist" ? 1 : 0),
      attendees: status === "going" && meUser ? [...(post.attendees || []).filter((a) => a.id !== meUser.id), meUser] : post.attendees,
    };
    emitBoardEvent({ type: "post.updated", post: next });
    refreshMyPlansSoon();
    toast(status === "going" ? t("ui_post_joined_toast") : status === "waitlist" ? t("ui_post_waitlist_toast") : t("ui_post_pending_toast"));
    if (status === "going" && post.chat_conversation_id == null) {
      // The plan chat comes with the post once I am going.
      api.boardPost(post.id).then((p) => emitBoardEvent({ type: "post.updated", post: { ...next, ...p } })).catch(() => undefined);
    }
    if (status === "going") loadConversations().catch(() => undefined);
    return next;
  } catch (e: any) {
    toast(e.message, "error");
    return null;
  }
}

export async function leavePost(post: Post, meId?: number) {
  try {
    await api.unattend(post.id);
    const next: Post = {
      ...post, my_status: null,
      going_count: Math.max(0, post.going_count - (post.my_status === "going" ? 1 : 0)),
      waitlist_count: Math.max(0, post.waitlist_count - (post.my_status === "waitlist" ? 1 : 0)),
      attendees: (post.attendees || []).filter((a) => a.id !== meId),
      chat_conversation_id: null,
    };
    emitBoardEvent({ type: "post.updated", post: next });
    refreshMyPlansSoon();
    loadConversations().catch(() => undefined);
    toast(post.my_status === "pending" ? t("ui_post_request_cancelled") : t("ui_post_left_toast"));
    return next;
  } catch (e: any) {
    toast(e.message, "error");
    return null;
  }
}

/** The sign-up control of a card: a button, or how I stand. */
function CardAttend({ post }: { post: Post }) {
  const me = useStore((s) => s.me);
  const [busy, setBusy] = useState(false);
  if (!isDated(post) || isPast(post)) return null;
  if (post.author.id === me?.id) return <span className="spill org">{t("ui_post_you_organise")}</span>;
  if (post.my_status === "going") return <span className="spill going"><Icon name="check" size="sm" />{t("ui_post_going")}</span>;
  if (post.my_status === "waitlist") return <span className="spill wait">{t("ui_post_on_waitlist")}</span>;
  if (post.my_status === "pending") return <span className="spill wait">{t("ui_post_request_sent")}</span>;
  if (post.closed) return <span className="spill">{t("ui_post_closed")}</span>;
  const full = !!post.capacity && post.going_count >= post.capacity;
  return (
    <button className="btn go sm" disabled={busy} onClick={async (e) => {
      e.stopPropagation();
      setBusy(true);
      await attendPost(post, me);
      setBusy(false);
    }}>{full ? t("ui_post_join_waitlist") : post.join_mode === "approval" ? t("ui_post_ask_join") : t("ui_post_sign_up")}</button>
  );
}

// ---------- the card ----------
export function PostCard({ post, showCommunity = true }: { post: Post; showCommunity?: boolean }) {
  const dated = isDated(post);
  const withCover = post.kind === "meetup" || post.kind === "event" || !!post.cover_url;
  const open = () => navigate(postPath(post.id));
  const past = isPast(post);
  return (
    <article className={"pcard k-" + post.kind + (past ? " past" : "")} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()} tabIndex={0} role="link" aria-label={post.title}>
      {withCover ? (
        <div className="pcover" style={{ background: post.cover_url ? `center / cover no-repeat url("${fileUrl(post.cover_url)}")` : coverGradient("p" + post.id) }}>
          {post.starts_at ? <DateTile iso={post.starts_at} /> : null}
          <div className="pflags">
            {post.pinned ? <span className="pflag"><Icon name="pin" size="sm" />{t("ui_post_pinned")}</span> : null}
            {past ? <span className="pflag">{t("ui_post_finished")}</span> : post.closed ? <span className="pflag">{t("ui_post_closed")}</span> : null}
          </div>
        </div>
      ) : null}
      <div className={"pbody" + (withCover ? "" : " nocover")}>
        <div className="prow">
          <KindTag kind={post.kind} />
          {!withCover && post.pinned ? <span className="ktag"><Icon name="pin" size="sm" />{t("ui_post_pinned")}</span> : null}
          {showCommunity ? (
            <button className="pcomm" onClick={(e) => { e.stopPropagation(); navigate(communityPath(post.community.id)); }}>{post.community.title}</button>
          ) : null}
        </div>
        <h3 className="ptitle">{post.title}</h3>
        {dated ? (
          <div className="pmeta">
            <span><Icon name="clock" size="sm" />{timeRange(post)}</span>
            {post.place ? <span><Icon name="place" size="sm" />{post.place}</span> : null}
          </div>
        ) : (
          <>
            {post.body ? <p className="pexcerpt">{post.body}</p> : null}
            <div className="pmeta">
              <span className="row" style={{ gap: 6 }}><Avatar user={post.author} size={20} />{post.author.display_name}</span>
              <span>{relative(post.created_at)}</span>
            </div>
          </>
        )}
        <div className="pfoot">
          {dated ? (
            <>
              <Faces users={post.attendees || []} max={4} size={24} />
              <span className="pplaces">{placesText(post)}</span>
            </>
          ) : null}
          <span className="pcomments"><Icon name="chat" size="sm" />{post.comment_count}</span>
          <span className="grow" />
          <CardAttend post={post} />
        </div>
        {dated && !past ? <PlacesBar post={post} /> : null}
      </div>
    </article>
  );
}

// ---------- a list of posts that follows live changes ----------
type FeedState = { posts: Post[] | null; hasMore: boolean; loading: boolean; error: string | null; fresh: boolean };

/** `belongs`: whether a new post (event) goes in this list; then "New posts" offers to reload it. */
export function usePostFeed(fetcher: (beforeId?: number) => Promise<PostPageData>, key: string, belongs?: (ev: BoardEvent) => boolean) {
  const [st, setSt] = useState<FeedState>({ posts: null, hasMore: false, loading: true, error: null, fresh: false });
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const belongsRef = useRef(belongs);
  belongsRef.current = belongs;
  const postsRef = useRef<Post[] | null>(null);
  postsRef.current = st.posts;

  const reload = useCallback(() => {
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null, fresh: false }));
    fetchRef.current()
      .then((page) => alive && setSt({ posts: page.posts || [], hasMore: !!page.has_more, loading: false, error: null, fresh: false }))
      // Not there yet (404) is an empty board, not an error.
      .catch((e) => alive && setSt({ posts: [], hasMore: false, loading: false, error: e?.status === 404 ? null : e.message, fresh: false }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setSt({ posts: null, hasMore: false, loading: true, error: null, fresh: false });
    return reload();
  }, [key, reload]);

  const loadMore = useCallback(async () => {
    const posts = st.posts;
    if (!posts?.length || !st.hasMore || st.loading) return;
    setSt((s) => ({ ...s, loading: true }));
    try {
      const page = await fetchRef.current(posts[posts.length - 1].id);
      setSt((s) => ({ ...s, posts: [...(s.posts || []), ...page.posts.filter((p) => !s.posts?.some((x) => x.id === p.id))], hasMore: !!page.has_more, loading: false }));
    } catch (e: any) {
      toast(e.message, "error");
      setSt((s) => ({ ...s, loading: false }));
    }
  }, [st.posts, st.hasMore, st.loading]);

  useEffect(() => onBoardEvent((ev) => {
    const id = eventPostId(ev);
    const patch = (p: Post) => setSt((s) => ({ ...s, posts: s.posts?.map((x) => (x.id === p.id ? { ...x, ...p } : x)) || null }));
    switch (ev.type) {
      case "post.created":
        if (!belongsRef.current || belongsRef.current(ev)) setSt((s) => ({ ...s, fresh: true }));
        break;
      case "post.updated":
      case "attendance.changed":
        if (!id || !postsRef.current?.some((x) => x.id === id)) break;
        if (ev.type === "post.updated" && ev.post) patch(ev.post);
        else api.boardPost(id).then(patch).catch(() => undefined);
        break;
      case "post.deleted":
        if (id) setSt((s) => ({ ...s, posts: s.posts?.filter((x) => x.id !== id) || null }));
        break;
      case "comment.created":
        if (id) setSt((s) => ({ ...s, posts: s.posts?.map((x) => (x.id === id ? { ...x, comment_count: x.comment_count + 1 } : x)) || null }));
        break;
    }
  }), []);

  return { ...st, reload, loadMore };
}

/** Posts, skeletons while loading, "Load more" and an automatic next page at the end. */
export function PostList({ feed, showCommunity = true, empty }: { feed: ReturnType<typeof usePostFeed>; showCommunity?: boolean; empty: React.ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const { loadMore } = feed;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, feed.posts?.length]);

  if (!feed.posts) return <Skeletons />;
  if (feed.error && !feed.posts.length) {
    return <EmptyState icon="info" title={t("ui_board_error")} body={feed.error} action={t("ui_board_retry")} onAction={feed.reload} />;
  }
  return (
    <>
      {feed.fresh ? <button className="freshpill" onClick={feed.reload}><Icon name="down" size="sm" />{t("ui_board_new_posts")}</button> : null}
      {feed.posts.length ? (
        <div className="plist2">
          {feed.posts.map((p) => <PostCard key={p.id} post={p} showCommunity={showCommunity} />)}
        </div>
      ) : empty}
      {feed.hasMore ? (
        <div ref={sentinel} className="more">
          <button className="btn" disabled={feed.loading} onClick={feed.loadMore}>{feed.loading ? t("ui_loading") : t("ui_board_load_more")}</button>
        </div>
      ) : null}
    </>
  );
}

// ---------- feed filters ----------
export type FilterKey = "all" | "today" | "weekend" | "week" | "meetup" | "event" | "notice";
export const FILTERS: [FilterKey, string, FeedFilter][] = [
  ["all", "ui_board_f_all", {}],
  ["today", "ui_board_f_today", { when: "today" }],
  ["weekend", "ui_board_f_weekend", { when: "weekend" }],
  ["week", "ui_board_f_week", { when: "week" }],
  ["meetup", "ui_board_f_meetups", { kind: "meetup" }],
  ["event", "ui_board_f_events", { kind: "event" }],
  ["notice", "ui_board_f_notices", { kind: "notice" }],
];

export function FilterChips({ value, onChange }: { value: FilterKey; onChange: (f: FilterKey) => void }) {
  return (
    <div className="chips bchips" role="tablist">
      {FILTERS.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} className={"chip" + (value === k ? " on" : "")} onClick={() => onChange(k)}>{t(label)}</button>
      ))}
    </div>
  );
}

function matchesFilter(p: Post, f: FeedFilter) {
  return !f.kind || p.kind === f.kind;
}

// ---------- Home ----------
/** Phone header: the icon and the wordmark over the brand glow, with shortcuts. */
export function PhoneTop({ title }: { title?: string }) {
  const conversations = useStore((s) => s.conversations);
  const mentions = Object.values(conversations).reduce((n, c) => n + c.mention_count, 0);
  return (
    <div className="phonetop">
      <img className="appicon" src="/apple-touch-icon.png" alt="" />
      {title ? <span className="phonetitle">{title}</span> : <Wordmark size={24} />}
      <span className="grow" />
      <ZoneTag />
      <button className="iconbtn glass" aria-label={t("ui_nav_mentions")} title={t("ui_nav_mentions")} onClick={() => navigate("/mentions")}>
        <Icon name="at" />{mentions ? <span className="bdg at dotbdg">{mentions > 9 ? "9+" : mentions}</span> : null}
      </button>
      <AvatarMenu />
    </div>
  );
}

/** My avatar at the top of the phone screens: my profile, settings, the administration and signing out. */
export function AvatarMenu() {
  const me = useStore((s) => s.me);
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const go = (path: string) => { setOpen(false); navigate(path); };
  return (
    <div className="avmenu-wrap">
      <button className="avmenu-btn" aria-label={t("ui_nav_profile")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Avatar user={me} size={36} />
      </button>
      {open ? (
        <>
          <div className="avmenu-bg" onClick={() => setOpen(false)} />
          <div className="avmenu" role="menu">
            <div className="avmenu-who"><b>{me.display_name}</b><span className="muted">{me.email}</span></div>
            <button role="menuitem" onClick={() => go("/account")}><Icon name="user" size="sm" />{t("ui_avatar_profile")}</button>
            <button role="menuitem" onClick={() => go("/account?section=settings")}><Icon name="sliders" size="sm" />{t("ui_avatar_settings")}</button>
            {me.role === "admin" ? <button role="menuitem" onClick={() => go("/admin")}><Icon name="shield" size="sm" />{t("ui_nav_admin")}</button> : null}
            <button role="menuitem" className="danger" onClick={() => { setOpen(false); signOut(); }}><Icon name="logout" size="sm" />{t("ui_logout")}</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function HomePage() {
  const me = useStore((s) => s.me);
  const myCommunities = useStore((s) => s.myCommunities);
  const [filter, setFilter] = useState<FilterKey>("all");
  const params = FILTERS.find(([k]) => k === filter)![2];
  const feed = usePostFeed((before) => api.boardFeed({ ...params, before_id: before, limit: 20 }), filter, (ev) => !ev.post || matchesFilter(ev.post, params));
  const noCommunities = myCommunities !== null && myCommunities.length === 0;

  let empty: React.ReactNode;
  if (noCommunities) {
    empty = <EmptyState icon="compass" title={t("ui_board_empty_join_title")} body={t("ui_board_empty_join_body")} action={t("ui_board_find_communities")} onAction={() => navigate("/communities")} />;
  } else if (filter !== "all") {
    empty = <EmptyState icon="calendar" title={t("ui_board_empty_filter_title")} body={t("ui_board_empty_filter_body")} action={t("ui_board_publish_plan")} onAction={() => navigate("/publish")} secondary={t("ui_board_see_all")} onSecondary={() => setFilter("all")} />;
  } else {
    empty = <EmptyState icon="layers" title={t("ui_board_empty_title")} body={t("ui_board_empty_body")} action={t("ui_board_publish_plan")} onAction={() => navigate("/publish")} secondary={t("ui_board_find_communities")} onSecondary={() => navigate("/communities")} />;
  }

  return (
    <main className="screen">
      <PhoneTop />
      <div className="swrap">
        <header className="shead deskonly">
          <div className="grow">
            <h1>{t("ui_board_title")}</h1>
            <p className="muted">{me ? t("ui_board_lead", { zone: me.province }) : null}</p>
          </div>
          <button className="btn go" onClick={() => navigate("/publish")}><Icon name="plus" size="sm" />{t("ui_nav_publish")}</button>
        </header>
        <FilterChips value={filter} onChange={setFilter} />
        <PostList feed={feed} empty={empty} />
      </div>
    </main>
  );
}

// ---------- post page ----------
export function PostPage({ id }: { id: number }) {
  const me = useStore((s) => s.me);
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [report, setReport] = useState(false);
  const [people, setPeople] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenu(false), menu);

  const load = useCallback(() => api.boardPost(id).then((p) => {
    setPost(p);
    setError(null);
    return p;
  }), [id]);

  useEffect(() => {
    setPost(null);
    load()
      .then((p) => api.community(p.community.id).then(setCommunity).catch(() => undefined))
      .catch((e) => setError(e.status === 404 ? t("ui_post_not_found") : e.message));
  }, [load]);

  useEffect(() => onBoardEvent((ev) => {
    if (eventPostId(ev) !== id) return;
    if (ev.type === "post.updated" && ev.post) setPost((p) => (p ? { ...p, ...ev.post } : p));
    else if (ev.type === "attendance.changed" || ev.type === "post.updated") load().catch(() => undefined);
    else if (ev.type === "post.deleted") {
      toast(t("ui_post_deleted_toast"));
      goBack("/");
    }
  }), [id, load]);

  if (error) {
    return (
      <main className="screen">
        <div className="swrap"><EmptyState icon="info" title={error} action={t("ui_board_back_home")} onAction={() => navigate("/")} /></div>
      </main>
    );
  }
  if (!post) {
    return <main className="screen"><div className="hero shimmer" /><div className="swrap"><Skeletons n={1} /></div></main>;
  }

  const staff = !!community?.role && STAFF_ROLES.includes(community.role);
  const mine = post.author.id === me?.id;
  const dated = isDated(post);
  const past = isPast(post);
  const canManage = post.can_edit || staff;
  const going = post.my_status === "going";
  const free = post.capacity ? Math.max(0, post.capacity - post.going_count) : null;
  const mapUrl = post.place_url || (post.place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(post.place)}` : null);

  async function patch(payload: Record<string, unknown>, done: string) {
    setMenu(false);
    try {
      const p = await api.updatePost(id, payload);
      setPost((x) => (x ? { ...x, ...p } : p));
      emitBoardEvent({ type: "post.updated", post: p });
      toast(done);
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  async function remove() {
    try {
      await api.deletePost(id);
      emitBoardEvent({ type: "post.deleted", post_id: id });
      refreshMyPlansSoon();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  async function act(fn: () => Promise<Post | null>) {
    setBusy(true);
    const next = await fn();
    if (next) setPost(next);
    setBusy(false);
  }

  let main: React.ReactNode = null;
  if (dated && !past) {
    if (mine) main = <button className="btn go" onClick={() => navigate(`/publish?edit=${id}`)}><Icon name="edit" size="sm" />{t("ui_post_edit")}</button>;
    else if (post.my_status) {
      main = (
        <button className="btn" disabled={busy} onClick={() => act(() => leavePost(post, me?.id))}>
          {post.my_status === "pending" ? t("ui_post_cancel_request") : post.my_status === "waitlist" ? t("ui_post_leave_waitlist") : t("ui_post_leave")}
        </button>
      );
    } else if (!post.closed) {
      const full = !!post.capacity && post.going_count >= post.capacity;
      main = (
        <button className="btn go" disabled={busy} onClick={() => act(() => attendPost(post, me))}>
          {full ? t("ui_post_join_waitlist") : post.join_mode === "approval" ? t("ui_post_ask_join") : t("ui_post_sign_up")}
        </button>
      );
    }
  } else if (dated && past) {
    main = <button className="btn go" onClick={() => navigate(`/publish?repeat=${id}`)}><Icon name="repeat" size="sm" />{t("ui_post_repeat")}</button>;
  }
  const chatBtn = post.chat_conversation_id && (going || mine) ? (
    <button className="btn" onClick={() => navigate(chatPath(post.chat_conversation_id!))}><Icon name="chat" size="sm" />{t("ui_post_open_chat")}</button>
  ) : null;

  return (
    <main className="screen detail">
      <div className="hero" style={{ background: post.cover_url ? `center / cover no-repeat url("${fileUrl(post.cover_url)}")` : coverGradient("p" + post.id) }}>
        <div className="herobar">
          <button className="iconbtn glass" onClick={() => goBack("/")} aria-label={t("ui_back")}><Icon name="back" /></button>
          <span className="grow" />
          <div ref={menuRef} style={{ position: "relative" }}>
            <button className="iconbtn glass" onClick={() => setMenu((v) => !v)} aria-label={t("ui_more")} aria-expanded={menu}><Icon name="more" /></button>
            {menu ? (
              <div className="menu" style={{ right: 0, top: 42 }} role="menu">
                <button onClick={() => { setMenu(false); navigator.clipboard?.writeText(window.location.href).then(() => toast(t("ui_copied"))).catch(() => undefined); }}><Icon name="link" size="sm" />{t("ui_post_copy_link")}</button>
                {post.can_edit ? <button onClick={() => navigate(`/publish?edit=${id}`)}><Icon name="edit" size="sm" />{t("ui_post_edit")}</button> : null}
                {dated && past ? <button onClick={() => navigate(`/publish?repeat=${id}`)}><Icon name="repeat" size="sm" />{t("ui_post_repeat")}</button> : null}
                {staff ? <button onClick={() => patch({ pinned: !post.pinned }, post.pinned ? t("ui_post_unpinned_toast") : t("ui_post_pinned_toast"))}><Icon name="pin" size="sm" />{post.pinned ? t("ui_post_unpin") : t("ui_post_pin")}</button> : null}
                {canManage ? <button onClick={() => patch({ closed: !post.closed }, post.closed ? t("ui_post_reopened_toast") : t("ui_post_closed_toast"))}><Icon name="lock" size="sm" />{post.closed ? t("ui_post_reopen") : t("ui_post_close")}</button> : null}
                {!mine ? <button onClick={() => { setMenu(false); setReport(true); }}><Icon name="flag" size="sm" />{t("ui_report")}</button> : null}
                {canManage ? <button className="warn" onClick={() => { setMenu(false); setConfirmDelete(true); }}><Icon name="trash" size="sm" />{t("ui_post_delete")}</button> : null}
              </div>
            ) : null}
          </div>
        </div>
        {post.starts_at && dated ? <DateTile iso={post.starts_at} big /> : null}
      </div>

      <div className="swrap pdetail">
        <div className="prow">
          <KindTag kind={post.kind} />
          <button className="ktag link" onClick={() => navigate(communityPath(post.community.id))}>{post.community.title}</button>
          {post.pinned ? <span className="ktag"><Icon name="pin" size="sm" />{t("ui_post_pinned")}</span> : null}
          {post.closed ? <span className="ktag"><Icon name="lock" size="sm" />{t("ui_post_closed")}</span> : null}
          {past ? <span className="ktag">{t("ui_post_finished")}</span> : null}
        </div>
        <h1 className="dtitle">{post.title}</h1>

        <div className="kv">
          {post.starts_at ? <div><span className="kvi"><Icon name="calendar" size="sm" /></span><span>{longWhen(post.starts_at)}{post.ends_at ? ` – ${new Date(post.ends_at).toDateString() === new Date(post.starts_at).toDateString() ? hourOf(post.ends_at) : longWhen(post.ends_at)}` : ""}{!past ? <span className="muted"> · {relative(post.starts_at)}</span> : null}</span></div> : null}
          {post.place ? <div><span className="kvi"><Icon name="place" size="sm" /></span><span>{post.place}{mapUrl ? <> · <a href={mapUrl} target="_blank" rel="noreferrer">{t("ui_post_see_map")}</a></> : null}</span></div> : null}
          <div><span className="kvi"><Icon name="user" size="sm" /></span><span className="row" style={{ gap: 6 }}><Avatar user={post.author} size={20} />{dated ? t("ui_post_organised_by", { name: post.author.display_name }) : t("ui_post_posted_by", { name: post.author.display_name })} <span className="muted">· {relative(post.created_at)}</span></span></div>
          {post.link_url ? <div><span className="kvi"><Icon name="ticket" size="sm" /></span><a href={post.link_url} target="_blank" rel="noreferrer">{t("ui_post_tickets")}</a></div> : null}
          {dated && post.join_mode === "approval" ? <div><span className="kvi"><Icon name="shield" size="sm" /></span><span>{t("ui_post_approval_note")}</span></div> : null}
        </div>

        {post.body ? <div className="pbodytext">{post.body}</div> : null}

        {dated ? (
          <section className="dsec">
            <div className="row">
              <h2 className="grow">{t("ui_post_people_going")}</h2>
              <button className="linkbtn" onClick={() => setPeople(true)}>{t("ui_post_see_all")}</button>
            </div>
            <button className="goingrow" onClick={() => setPeople(true)}>
              {post.attendees?.length ? <Faces users={post.attendees} max={8} size={34} /> : <span className="muted">{t("ui_post_nobody_yet")}</span>}
              <span className="grow" />
              <span className="pplaces">
                {placesText(post)}{free != null && free > 0 ? ` · ${t("ui_post_free_n", { n: free })}` : ""}
                {post.waitlist_count ? ` · ${t("ui_post_waitlist_n", { n: post.waitlist_count })}` : ""}
              </span>
            </button>
            {!past ? <PlacesBar post={post} /> : null}
            {post.my_status === "waitlist" ? <div className="note"><Icon name="info" size="sm" />{t("ui_post_waitlist_note")}</div> : null}
            {post.my_status === "pending" ? <div className="note"><Icon name="info" size="sm" />{t("ui_post_pending_note")}</div> : null}
          </section>
        ) : null}

        <Comments post={post} />
      </div>

      {main || chatBtn ? (
        <div className="dbar">
          {chatBtn}
          {main}
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmModal title={t("ui_post_delete")} body={dated ? t("ui_post_delete_plan_body") : t("ui_post_delete_body")} confirm={t("ui_post_delete")} danger onConfirm={remove} onClose={() => setConfirmDelete(false)} />
      ) : null}
      {report ? <ReportPostModal postId={id} onClose={() => setReport(false)} /> : null}
      {people ? <AttendeesModal post={post} manage={canManage} onClose={() => setPeople(false)} onChanged={() => load().catch(() => undefined)} /> : null}
    </main>
  );
}

function Comments({ post }: { post: Post }) {
  const [items, setItems] = useState<Comment[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.comments(post.id).then((r) => {
      setItems(r.comments);
      setHasMore(r.has_more);
    }).catch(() => setItems([]));
  }, [post.id]);

  useEffect(() => onBoardEvent((ev) => {
    if (ev.type !== "comment.created" || !ev.comment || ev.comment.post_id !== post.id) return;
    const c = ev.comment;
    setItems((xs) => (xs && !xs.some((x) => x.id === c.id) ? [...xs, c] : xs));
  }), [post.id]);

  async function older() {
    if (!items?.length) return;
    try {
      const r = await api.comments(post.id, items[0].id);
      setItems((xs) => [...r.comments, ...(xs || [])]);
      setHasMore(r.has_more);
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const c = await api.addComment(post.id, body);
      setItems((xs) => (xs?.some((x) => x.id === c.id) ? xs : [...(xs || []), c]));
      setText("");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Comment) {
    try {
      await api.deleteComment(c.id);
      setItems((xs) => xs?.filter((x) => x.id !== c.id) || null);
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  let lock: string | null = null;
  if (post.closed) lock = t("ui_post_closed_note");
  else if (post.comments_mode === "off") lock = t("ui_post_comments_off");
  else if (post.comments_mode === "attendees") lock = t("ui_post_comments_attendees");
  else if (!post.can_comment) lock = t("ui_post_comments_cant");

  return (
    <section className="dsec">
      <h2>{t("ui_post_comments")}{items?.length ? <span className="muted"> · {Math.max(items.length, post.comment_count)}</span> : null}</h2>
      {lock ? <div className="lockline"><Icon name="lock" size="sm" />{lock}</div> : null}
      {hasMore ? <button className="linkbtn" onClick={older}>{t("ui_post_older_comments")}</button> : null}
      {items === null ? <div className="sk w60" /> : null}
      {items?.map((c) => (
        <div key={c.id} className="cmt">
          <Avatar user={c.author} size={30} />
          <div className="cmtb">
            <div className="row" style={{ gap: 6 }}><b>{c.author.display_name}</b><span className="muted">{relative(c.created_at)}</span>
              {c.can_delete ? <button className="iconbtn tiny" aria-label={t("ui_delete")} title={t("ui_delete")} onClick={() => remove(c)}><Icon name="trash" size="sm" /></button> : null}
            </div>
            <div className="cmtt">{c.body}</div>
          </div>
        </div>
      ))}
      {items && !items.length && post.can_comment ? <div className="muted">{t("ui_post_no_comments")}</div> : null}
      {post.can_comment && !post.closed && post.comments_mode !== "off" ? (
        <div className="cbox">
          <textarea id="post-comment" className="inp" rows={1} maxLength={2000} value={text} placeholder={t("ui_post_comment_ph")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
          <button className="sendb" disabled={busy || !text.trim()} onClick={send} aria-label={t("ui_send")}><Icon name="send" size="sm" /></button>
        </div>
      ) : null}
    </section>
  );
}

function AttendeesModal({ post, manage, onClose, onChanged }: { post: Post; manage: boolean; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<Attendee[] | null>(null);
  const load = useCallback(() => api.attendees(post.id).then(setList).catch(() => setList(post.attendees?.map((a) => ({ ...a, status: "going" as const })) || [])), [post.id, post.attendees]);
  useEffect(() => {
    load();
  }, [load]);
  async function resolve(userId: number, accept: boolean) {
    try {
      await api.resolveAttendee(post.id, userId, accept);
      toast(accept ? t("ui_post_accepted_toast") : t("ui_post_rejected_toast"));
      load();
      onChanged();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  const groups: [string, Attendee[]][] = [
    [t("ui_post_pending_requests"), (list || []).filter((a) => a.status === "pending")],
    [t("ui_post_going"), (list || []).filter((a) => a.status === "going")],
    [t("ui_post_waitlist"), (list || []).filter((a) => a.status === "waitlist")],
  ];
  return (
    <Modal title={t("ui_post_people_going")} onClose={onClose}>
      {!list ? <div className="muted">{t("ui_loading")}</div> : null}
      {list && !list.length ? <div className="muted">{t("ui_post_nobody_yet")}</div> : null}
      {groups.map(([label, xs]) => xs.length ? (
        <div key={label}>
          <div className="lsec" style={{ padding: "4px 0" }}>{label} · {xs.length}</div>
          <div className="plist">
            {xs.map((a) => (
              <div key={a.id} className="item">
                <Avatar user={a} size={34} />
                <span className="grow">{a.display_name}{a.id === post.author.id ? <span className="role" style={{ marginLeft: 6 }}>{t("ui_post_organiser")}</span> : null}</span>
                {manage && a.status === "pending" ? (
                  <>
                    <button className="btn sm pri" onClick={() => resolve(a.id, true)}>{t("ui_accept")}</button>
                    <button className="btn sm" onClick={() => resolve(a.id, false)}>{t("ui_decline")}</button>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null)}
    </Modal>
  );
}

const REASONS = ["child_safety", "spam", "harassment", "hate", "sexual", "violence", "other"];

function ReportPostModal({ postId, onClose }: { postId: number; onClose: () => void }) {
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  return (
    <Modal title={t("ui_post_report_title")} onClose={onClose} footer={(
      <>
        <button className="btn" onClick={onClose}>{t("ui_cancel")}</button>
        <button className="btn pri" onClick={() => api.reportPost(postId, reason, details.trim() || undefined).then(() => { toast(t("ui_reported")); onClose(); }).catch((e) => toast(e.message, "error"))}>{t("ui_report")}</button>
      </>
    )}>
      <label className="fld">{t("ui_reason")}
        <select id="post-report-reason" className="inp" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => <option key={r} value={r}>{t("ui_reason_" + r)}</option>)}
        </select>
      </label>
      <label className="fld">{t("ui_post_report_details")}<textarea id="post-report-details" className="inp" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
    </Modal>
  );
}

// ---------- publish ----------
type Form = {
  kind: PostKind; community_id: number | null; title: string; body: string;
  date: string; time: string; endDate: string; endTime: string; place: string; place_url: string;
  limit: boolean; capacity: number; link_url: string; comments_mode: "all" | "attendees" | "off"; approval: boolean;
  cover: { id: number; url: string } | null;
};

const EMPTY_FORM: Form = {
  kind: "meetup", community_id: null, title: "", body: "", date: "", time: "", endDate: "", endTime: "", place: "", place_url: "",
  limit: false, capacity: 8, link_url: "", comments_mode: "all", approval: false, cover: null,
};

function Toggle({ label, hint, on, onChange, id }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <label className="tgl" htmlFor={id}>
      <span className="grow">{label}{hint ? <small>{hint}</small> : null}</span>
      <input id={id} type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw" aria-hidden="true" />
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export function PublishPage({ community, repeat, edit }: { community: number | null; repeat: number | null; edit: number | null }) {
  const myCommunities = useStore((s) => s.myCommunities);
  const [form, setForm] = useState<Form>({ ...EMPTY_FORM, community_id: community });
  const [loading, setLoading] = useState(!!(repeat || edit));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (myCommunities === null) loadMyCommunities();
  }, [myCommunities]);

  // Repeat copies a past plan (without its date); edit loads the post as it is.
  useEffect(() => {
    const source = edit || repeat;
    if (!source) return;
    api.boardPost(source).then((p) => {
      const start = toLocalParts(p.starts_at);
      const end = toLocalParts(p.ends_at);
      setForm({
        kind: p.kind, community_id: p.community.id, title: p.title, body: p.body || "",
        date: edit ? start.date : "", time: start.time, endDate: edit ? end.date : "", endTime: end.time,
        place: p.place || "", place_url: p.place_url || "", limit: !!p.capacity, capacity: p.capacity || 8, link_url: p.link_url || "",
        comments_mode: p.comments_mode, approval: p.join_mode === "approval", cover: null,
      });
    }).catch((e) => toast(e.message, "error")).finally(() => setLoading(false));
  }, [edit, repeat]);

  const eligible = useMemo(
    () => (myCommunities || []).filter((c) => c.joined && (c.board_mode === "open" || (!!c.role && STAFF_ROLES.includes(c.role)))),
    [myCommunities],
  );
  useEffect(() => {
    if (!form.community_id && eligible.length === 1) set({ community_id: eligible[0].id });
  }, [eligible, form.community_id]);

  const dated = form.kind === "meetup" || form.kind === "event";
  const starts = fromLocalParts(form.date, form.time);
  const ends = form.kind === "event" && form.endTime ? fromLocalParts(form.endDate || form.date, form.endTime) : null;
  const problems: string[] = [];
  if (!form.title.trim()) problems.push(t("ui_publish_need_title"));
  if (!edit && !form.community_id) problems.push(t("ui_publish_need_community"));
  if (dated && (!form.date || !form.time)) problems.push(t("ui_publish_need_date"));
  if (dated && starts && !edit && new Date(starts) < new Date()) problems.push(t("ui_publish_date_past"));
  if (ends && starts && ends <= starts) problems.push(t("ui_publish_end_before"));

  async function uploadCover(file: File) {
    setUploading(true);
    try {
      const res = await api.upload(file);
      set({ cover: { id: res.id, url: res.url } });
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (problems.length) {
      toast(problems[0], "error");
      return;
    }
    setBusy(true);
    const payload: Record<string, unknown> = {
      title: form.title.trim(), body: form.body.trim() || null,
      comments_mode: !dated && form.comments_mode === "attendees" ? "all" : form.comments_mode,
    };
    if (!edit) payload.kind = form.kind;
    if (dated) {
      Object.assign(payload, {
        starts_at: starts, ends_at: ends, place: form.place.trim() || null, place_url: form.place_url.trim() || null,
        capacity: form.limit ? Math.max(1, Math.round(form.capacity)) : null, join_mode: form.approval ? "approval" : "open",
      });
      if (form.kind === "event") payload.link_url = form.link_url.trim() || null;
    }
    if (form.cover) payload.cover_attachment_id = form.cover.id;
    try {
      const post = edit ? await api.updatePost(edit, payload) : await api.createPost(form.community_id!, payload);
      emitBoardEvent({ type: edit ? "post.updated" : "post.created", post });
      refreshMyPlansSoon();
      toast(edit ? t("ui_publish_saved_toast") : t("ui_publish_done_toast"));
      if (!edit && dated) loadConversations().catch(() => undefined);
      navigate(postPath(post.id), true);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const kinds: [PostKind, string][] = [["meetup", t("ui_post_kind_meetup")], ["event", t("ui_post_kind_event")], ["notice", t("ui_post_kind_notice")], ["thread", t("ui_post_kind_thread")]];
  const commentOptions: ["all" | "attendees" | "off", string][] = dated
    ? [["all", t("ui_publish_comments_all")], ["attendees", t("ui_publish_comments_attendees")], ["off", t("ui_publish_comments_off")]]
    : [["all", t("ui_publish_comments_all")], ["off", t("ui_publish_comments_off")]];
  const kindHint: Record<PostKind, string> = {
    meetup: t("ui_publish_hint_meetup"), event: t("ui_publish_hint_event"), notice: t("ui_publish_hint_notice"), thread: t("ui_publish_hint_thread"),
  };

  if (myCommunities !== null && !eligible.length && !edit) {
    return (
      <main className="screen detail">
        <div className="formtop"><button className="iconbtn" onClick={() => goBack("/")} aria-label={t("ui_back")}><Icon name="x" /></button><h1 className="grow">{t("ui_publish_title")}</h1></div>
        <div className="swrap"><EmptyState icon="compass" title={t("ui_publish_no_communities_title")} body={t("ui_publish_no_communities_body")} action={t("ui_board_find_communities")} onAction={() => navigate("/communities")} /></div>
      </main>
    );
  }

  return (
    <main className="screen detail">
      <div className="formtop">
        <button className="iconbtn" onClick={() => goBack("/")} aria-label={t("ui_cancel")}><Icon name="x" /></button>
        <h1 className="grow">{edit ? t("ui_publish_edit_title") : repeat ? t("ui_publish_repeat_title") : t("ui_publish_title")}</h1>
        <button className="btn go sm deskonly" disabled={busy || loading || uploading} onClick={submit}>{edit ? t("ui_save") : t("ui_publish_button")}</button>
      </div>
      <div className="swrap pform">
        {loading ? <Skeletons n={1} /> : (
          <>
            {!edit ? <Seg label={t("ui_publish_kind")} value={form.kind} options={kinds} onChange={(kind) => set({ kind })} /> : null}
            <p className="muted hint">{kindHint[form.kind]}</p>

            {!edit ? (
              <label className="fld">{t("ui_publish_where")}
                <select id="pub-community" className="inp" value={form.community_id ?? ""} onChange={(e) => set({ community_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">{t("ui_publish_choose_community")}</option>
                  {eligible.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
            ) : null}

            <label className="fld">{t("ui_publish_f_title")}
              <input id="pub-title" className="inp" maxLength={140} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={t("ui_publish_title_ph_" + form.kind)} />
            </label>
            <label className="fld">{t("ui_publish_f_body")}
              <textarea id="pub-body" className="inp" rows={4} maxLength={5000} value={form.body} onChange={(e) => set({ body: e.target.value })} placeholder={t("ui_publish_body_ph")} />
            </label>

            {dated ? (
              <>
                <div className="grid2c">
                  <label className="fld">{t("ui_publish_f_date")}<input id="pub-date" className="inp" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} /></label>
                  <label className="fld">{t("ui_publish_f_time")}<input id="pub-time" className="inp" type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} /></label>
                </div>
                {form.kind === "event" ? (
                  <div className="grid2c">
                    <label className="fld">{t("ui_publish_f_end_date")}<input id="pub-end-date" className="inp" type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} /></label>
                    <label className="fld">{t("ui_publish_f_end_time")}<input id="pub-end-time" className="inp" type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} /></label>
                  </div>
                ) : null}
                <label className="fld">{t("ui_publish_f_place")}<input id="pub-place" className="inp" maxLength={200} value={form.place} onChange={(e) => set({ place: e.target.value })} placeholder={t("ui_publish_place_ph")} /></label>
                <label className="fld">{t("ui_publish_f_place_url")}<input id="pub-place-url" className="inp" type="url" inputMode="url" value={form.place_url} onChange={(e) => set({ place_url: e.target.value })} placeholder="https://…" /></label>
                {form.kind === "event" ? (
                  <label className="fld">{t("ui_publish_f_link")}<input id="pub-link" className="inp" type="url" inputMode="url" value={form.link_url} onChange={(e) => set({ link_url: e.target.value })} placeholder="https://…" /></label>
                ) : null}
                <div className="fld">
                  <span>{t("ui_publish_f_cover")}</span>
                  <div className="coverpick" style={{ background: form.cover ? `center / cover no-repeat url("${fileUrl(form.cover.url)}")` : coverGradient(form.title || "new") }}>
                    <label className="btn sm glassbtn">
                      <Icon name="image" size="sm" />{uploading ? t("ui_loading") : form.cover ? t("ui_publish_cover_change") : t("ui_publish_cover_add")}
                      <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadCover(e.target.files[0])} />
                    </label>
                    {form.cover ? <button className="btn sm glassbtn" onClick={() => set({ cover: null })}>{t("ui_remove")}</button> : null}
                  </div>
                </div>
              </>
            ) : null}

            <div className="fsec">
              <h2>{t("ui_publish_rules")}</h2>
              <div className="fld"><span>{t("ui_publish_who_comments")}</span>
                <Seg label={t("ui_publish_who_comments")} value={!dated && form.comments_mode === "attendees" ? "all" : form.comments_mode} options={commentOptions} onChange={(comments_mode) => set({ comments_mode })} />
              </div>
              {dated ? (
                <>
                  <Toggle id="pub-approval" label={t("ui_publish_approval")} hint={t("ui_publish_approval_hint")} on={form.approval} onChange={(approval) => set({ approval })} />
                  <Toggle id="pub-limit" label={t("ui_publish_limit")} hint={t("ui_publish_limit_hint")} on={form.limit} onChange={(limit) => set({ limit })} />
                  {form.limit ? (
                    <div className="stepper">
                      <span className="grow">{t("ui_publish_places")}</span>
                      <button className="iconbtn" aria-label="−" onClick={() => set({ capacity: Math.max(1, form.capacity - 1) })}>−</button>
                      <input id="pub-capacity" className="inp" type="number" min={1} max={10000} inputMode="numeric" value={form.capacity} onChange={(e) => set({ capacity: Number(e.target.value) || 1 })} />
                      <button className="iconbtn" aria-label="+" onClick={() => set({ capacity: form.capacity + 1 })}><Icon name="plus" size="sm" /></button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </>
        )}
      </div>
      <div className="dbar single phoneonly">
        <button className="btn go" disabled={busy || loading || uploading} onClick={submit}>{edit ? t("ui_save") : t("ui_publish_button")}</button>
      </div>
    </main>
  );
}

export const ageText = (a?: string | null) => (a || "").replace("_plus", "+").replace("_", "-");

/** My zone (or the one I am looking at) always in view; tapping it lets me look at another zone's communities. */
export function ZoneTag() {
  const me = useStore((s) => s.me);
  const browse = useStore((s) => s.browseZone);
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const zone = browse || { province: me.province, age_range: me.age_range };
  return (
    <>
      <button className={"zonetag" + (browse ? " other" : "")} onClick={() => setOpen(true)} title={t("ui_zone_change")} aria-label={t("ui_zone_change")}>
        <Icon name="place" size="sm" /><span>{zone.province} · {ageText(zone.age_range)}</span>
      </button>
      {open ? <ZoneModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ZoneModal({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me)!;
  const browse = useStore((s) => s.browseZone);
  const [geo, setGeo] = useState<any>(null);
  const start = browse || { province: me.province, age_range: me.age_range };
  const [country, setCountry] = useState(me.country || "ES");
  const [province, setProvince] = useState(start.province);
  const [age, setAge] = useState(start.age_range);
  useEffect(() => {
    api.publicSettings().then(setGeo).catch(() => setGeo({}));
  }, []);
  const provinces: { value: string; name: string }[] = geo?.provinces_by_country?.[country] || [];
  const mine = (p: string, a: string) => p === me.province && a === me.age_range;
  function look() {
    setState({ browseZone: mine(province, age) ? null : { province, age_range: age } });
    onClose();
    navigate("/communities");
  }
  return (
    <Modal title={t("ui_zone_title")} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>{t("ui_zone_lead", { zone: `${me.province} · ${ageText(me.age_range)}` })}</p>
      <div className="grid2">
        <label className="fld">{t("ui_country")}
          <select id="zone-country" className="inp" value={country} onChange={(e) => { setCountry(e.target.value); setProvince(""); }}>
            {countryOptions(geo?.countries).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
        <label className="fld">{t("ui_province")}
          <select id="zone-province" className="inp" value={province} onChange={(e) => setProvince(e.target.value)}>
            <option value="">{t("ui_choose")}</option>
            {provinces.map((p) => <option key={p.value} value={p.value}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <label className="fld">{t("ui_zone_age")}
        <select id="zone-age" className="inp" value={age} onChange={(e) => setAge(e.target.value)}>
          {["18_30", "31_60", "61_plus"].map((a) => <option key={a} value={a}>{ageText(a)}</option>)}
        </select>
      </label>
      <div className="stack" style={{ gap: 8, marginTop: 6 }}>
        <button className="btn pri block" disabled={!province} onClick={look}><Icon name="compass" size="sm" />{t("ui_zone_look")}</button>
        {browse ? <button className="btn block" onClick={() => { setState({ browseZone: null }); onClose(); navigate("/communities"); }}>{t("ui_zone_back_mine")}</button> : null}
        <button className="linkbtn" onClick={() => { onClose(); navigate("/account"); }}>{t("ui_zone_move")}</button>
      </div>
    </Modal>
  );
}
