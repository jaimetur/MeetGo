// Communities of my zone: the list, creating one, and a community's page (board, chat and members).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@lang";
import { api, fileUrl } from "../api";
import { coverGradient } from "../board";
import { chatPath, communityPath, goBack, navigate } from "../router";
import { getState, loadConversations, loadMyCommunities, setState, toast, useStore } from "../store";
import type { AccessMode, BoardMode, Community, CommunityMember, Post, UserSummary } from "../types";
import { Avatar, Icon, Modal, hobbyIcon } from "./common";
import { RichEditor, RichText } from "./RichText";
import { ConfirmModal, EmptyState, FilterChips, FILTERS, type FilterKey, PhoneTop, PostCard, PostList, STAFF_ROLES, Seg, usePostFeed } from "./Board";

const ACCESS_KEYS: Record<AccessMode, string> = { open: "ui_community_access_open", request: "ui_community_access_request", invite: "ui_community_access_invite" };
const ROLE_KEYS: Record<string, string> = { owner: "ui_role_owner", admin: "ui_role_admin", moderator: "ui_role_moderator", member: "ui_role_member" };
const RANK: Record<string, number> = { owner: 3, admin: 2, moderator: 1, member: 0 };

function zoneLabel(c: Community) {
  return `${c.province} · ${(c.age_range || "").replace("_plus", "+").replace("_", "-")}`;
}

function CommunityBadge({ c, size = 52 }: { c: Community; size?: number }) {
  if (c.avatar_url) return <img className="cbadge" src={fileUrl(c.avatar_url)} alt="" style={{ width: size, height: size }} />;
  return (
    <span className="cbadge" style={{ width: size, height: size, background: coverGradient("c" + c.id) }} aria-hidden="true">
      <Icon name={hobbyIcon(c.slug, c.title)} className="cbadge-ic" />
    </span>
  );
}

/** Join, ask to join, or the state I am in. Returns the new community state. */
async function joinCommunity(c: Community): Promise<Community | null> {
  try {
    const { status } = await api.joinCommunity(c.id);
    if (status === "joined") {
      toast(t("ui_community_joined_toast", { name: c.title }));
      loadConversations().catch(() => undefined);
      loadMyCommunities();
      return { ...c, joined: true, role: "member", member_count: c.member_count + 1, request_pending: false };
    }
    toast(t("ui_community_requested_toast"));
    return { ...c, request_pending: true };
  } catch (e: any) {
    toast(e.message, "error");
    return null;
  }
}

function JoinButton({ c, onChange, big }: { c: Community; onChange: (c: Community) => void; big?: boolean }) {
  const [busy, setBusy] = useState(false);
  const cls = "btn " + (big ? "" : "sm ");
  if (c.joined) return <button className={cls} onClick={(e) => { e.stopPropagation(); navigate(communityPath(c.id)); }}>{t("ui_open")}</button>;
  if (c.request_pending) return <span className="spill wait">{t("ui_community_requested")}</span>;
  if (c.access_mode === "invite") return <span className="spill"><Icon name="lock" size="sm" />{t("ui_community_access_invite")}</span>;
  return (
    <button className={cls + "go"} disabled={busy} onClick={async (e) => {
      e.stopPropagation();
      setBusy(true);
      const next = await joinCommunity(c);
      setBusy(false);
      if (next) onChange(next);
    }}>{c.access_mode === "request" ? t("ui_community_ask_join") : t("ui_join")}</button>
  );
}

function CommunityCard({ c, onChange }: { c: Community; onChange: (c: Community) => void }) {
  return (
    <article className="ccard" role="link" tabIndex={0} onClick={() => navigate(communityPath(c.id))} onKeyDown={(e) => e.key === "Enter" && navigate(communityPath(c.id))}>
      {/* the hobby's silhouette as a soft watermark, tinted with the community's colours */}
      <span className="cwm" style={{ background: coverGradient("c" + c.id) }} aria-hidden="true"><Icon name={hobbyIcon(c.slug, c.title)} /></span>
      <div className="cbody">
        <div className="ctop">
          <CommunityBadge c={c} />
          <div style={{ minWidth: 0 }}>
            <div className="ctitle">{c.title}</div>
            <div className="cstats">
              <span>{t("ui_members_n", { n: c.member_count })}</span>
              {c.online_count ? <span><span className="odot" />{t("ui_community_online_n", { n: c.online_count })}</span> : null}
              {c.upcoming_count ? <span>{t("ui_community_plans_n", { n: c.upcoming_count })}</span> : null}
            </div>
          </div>
        </div>
        {c.description ? <p className="cdesc">{c.description}</p> : null}
        <div className="row">
          {c.access_mode !== "open" ? <span className="ktag"><Icon name="lock" size="sm" />{t(ACCESS_KEYS[c.access_mode])}</span> : null}
          {c.role && c.role !== "member" ? <span className="ktag k-meetup">{t(ROLE_KEYS[c.role])}</span> : null}
          <span className="grow" />
          <JoinButton c={c} onChange={onChange} />
        </div>
      </div>
    </article>
  );
}

/** Categories of communities, from the interest's slug or the title (any language); the rest go to "Other". */
const CATEGORIES: [string, RegExp][] = [
  ["ui_cat_social", /tomar|caf[eé]|cerve|beer|copa|drink|picnic|network|gastro|comida|cena|food|tapas/],
  ["ui_cat_sports", /deport|sport|futbol|fútbol|football|soccer|tenis|tennis|padel|pádel|fitness|crossfit|gym|cicl|bici|bike|mtb|run|correr|nata|swim|surf|yoga/],
  ["ui_cat_nature", /sender|hik|trek|monta|mountain|playa|beach|viaj|travel|natur|camp/],
  ["ui_cat_culture", /cine|film|movie|lect|libro|book|read|m[uú]sic|music|concier|concert|rock|flamenc|arte|art|foto|photo|teatro|theat/],
  ["ui_cat_motor", /coche|car\b|auto|moto/],
];

export function communityCategory(c: Community): string {
  const text = `${c.slug || ""} ${c.title || ""}`.toLowerCase();
  return CATEGORIES.find(([, re]) => re.test(text))?.[0] || "ui_cat_other";
}

const byTitle = (a: Community, b: Community) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

/** The communities by category (in the order above, "Other" last), each in alphabetical order. */
function byCategory(list: Community[]): [string, Community[]][] {
  const order = [...CATEGORIES.map(([k]) => k), "ui_cat_other"];
  const groups = new Map<string, Community[]>();
  for (const c of list) {
    const k = communityCategory(c);
    groups.set(k, [...(groups.get(k) || []), c]);
  }
  return order.filter((k) => groups.has(k)).map((k) => [k, groups.get(k)!.sort(byTitle)]);
}

// Coming back to the list (Back from a community) shows it as it was: the same search, the list at once, and
// the same scroll position, instead of starting again from the top.
const listMemory: { q: string; list: Community[] | null; scroll: number } = { q: "", list: null, scroll: 0 };

export function CommunitiesPage() {
  const me = useStore((s) => s.me);
  const [q, setQ] = useState(listMemory.q);
  const [list, setListState] = useState<Community[] | null>(listMemory.list);
  const setList: React.Dispatch<React.SetStateAction<Community[] | null>> = (v) => setListState((prev) => {
    const next = typeof v === "function" ? (v as (p: Community[] | null) => Community[] | null)(prev) : v;
    listMemory.list = next;
    return next;
  });
  const scroller = React.useRef<HTMLElement>(null);
  const restored = React.useRef(false);
  useEffect(() => {
    listMemory.q = q;
  }, [q]);
  React.useLayoutEffect(() => {
    if (restored.current || !list || !scroller.current) return;
    restored.current = true;
    scroller.current.scrollTop = listMemory.scroll;
  }, [list]);
  const [error, setError] = useState<string | null>(null);
  const [create, setCreate] = useState(false);

  const load = useCallback((query: string) => {
    setError(null);
    api.communities({ q: query || undefined }).then(setList).catch((e) => {
      setList([]);
      if (e?.status !== 404) setError(e.message);
    });
  }, []);
  useEffect(() => {
    const id = window.setTimeout(() => load(q.trim()), q ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [q, load]);

  const update = (c: Community) => setList((xs) => xs?.map((x) => (x.id === c.id ? c : x)) || null);
  const mine = (list || []).filter((c) => c.joined).sort(byTitle);
  const others = byCategory((list || []).filter((c) => !c.joined));

  return (
    <main className="screen" ref={scroller} onScroll={(e) => { listMemory.scroll = e.currentTarget.scrollTop; }}>
      <PhoneTop title={t("ui_nav_communities")} />
      <div className="swrap">
        <header className="shead">
          <div className="grow">
            <h1 className="deskonly">{t("ui_community_title")}</h1>
            <p className="muted">{me ? t("ui_community_lead", { zone: me.province }) : null}</p>
          </div>
          <button className="btn go" onClick={() => setCreate(true)}><Icon name="plus" size="sm" />{t("ui_community_create")}</button>
        </header>
        <div className="search big">
          <Icon name="search" size="sm" />
          <input id="community-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_community_search_ph")} aria-label={t("ui_community_search_ph")} />
          {q ? <button className="iconbtn" style={{ width: 26, height: 26 }} onClick={() => setQ("")} aria-label={t("ui_clear")}><Icon name="x" size="sm" /></button> : null}
        </div>

        {list === null ? (
          <div className="cgrid">{[0, 1, 2, 3].map((i) => <div key={i} className="ccard skel"><div className="ccover shimmer" /><div className="cbody"><span className="sk w60 h18" /><span className="sk w80" /></div></div>)}</div>
        ) : error ? (
          <EmptyState icon="info" title={t("ui_board_error")} body={error} action={t("ui_board_retry")} onAction={() => load(q.trim())} />
        ) : !list.length ? (
          q ? <EmptyState icon="search" title={t("ui_no_results")} body={t("ui_community_no_match")} action={t("ui_community_create")} onAction={() => setCreate(true)} />
            : <EmptyState icon="compass" title={t("ui_community_empty_title")} body={t("ui_community_empty_body")} action={t("ui_community_create")} onAction={() => setCreate(true)} />
        ) : (
          <>
            {mine.length ? <><div className="lsec">{t("ui_community_yours")}</div><div className="cgrid">{mine.map((c) => <CommunityCard key={c.id} c={c} onChange={update} />)}</div></> : null}
            {others.length ? <h2 className="lsec csec-discover">{t("ui_community_discover")}</h2> : null}
            {others.map(([cat, items]) => (
              <section key={cat} className="ccat">
                <div className="lsec ccat-title">{t(cat)} <span className="muted">· {items.length}</span></div>
                <div className="cgrid">{items.map((c) => <CommunityCard key={c.id} c={c} onChange={update} />)}</div>
              </section>
            ))}
          </>
        )}
      </div>
      {create ? <CommunityFormModal onClose={() => setCreate(false)} /> : null}
    </main>
  );
}

/** Create a community, or change one (owner and admins). */
function CommunityFormModal({ community, onClose, onSaved }: { community?: Community; onClose: () => void; onSaved?: (c: Community) => void }) {
  const [form, setForm] = useState({
    title: community?.title || "", description: community?.description || "", rules: community?.rules || "",
    access_mode: (community?.access_mode || "open") as AccessMode, board_mode: (community?.board_mode || "open") as BoardMode,
  });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  async function save() {
    setBusy(true);
    try {
      const payload = { title: form.title.trim(), description: form.description.trim() || undefined, access_mode: form.access_mode, board_mode: form.board_mode };
      if (community) {
        const c = await api.updateCommunity(community.id, { ...payload, rules: form.rules.trim() || null });
        toast(t("ui_saved"));
        onSaved?.(c);
        loadMyCommunities();
        onClose();
      } else {
        const c = await api.createCommunity(payload);
        toast(t("ui_community_created_toast"));
        loadMyCommunities();
        loadConversations().catch(() => undefined);
        onClose();
        navigate(communityPath(c.id));
      }
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  const accessHints: Record<AccessMode, string> = {
    open: t("ui_community_access_open_hint"), request: t("ui_community_access_request_hint"), invite: t("ui_community_access_invite_hint"),
  };
  return (
    <Modal title={community ? t("ui_community_settings") : t("ui_community_create")} onClose={onClose} footer={(
      <>
        <button className="btn" onClick={onClose}>{t("ui_cancel")}</button>
        <button className="btn pri" disabled={busy || form.title.trim().length < 3} onClick={save}>{community ? t("ui_save") : t("ui_community_create_button")}</button>
      </>
    )}>
      {!community ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("ui_community_create_lead")}</p> : null}
      <label className="fld">{t("ui_community_f_title")}<input id="cm-title" className="inp" maxLength={80} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={t("ui_community_title_ph")} /></label>
      <label className="fld">{t("ui_description")}<textarea id="cm-desc" className="inp" rows={3} maxLength={1000} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("ui_community_desc_ph")} /></label>
      {community ? <div className="fld">{t("ui_community_f_rules")}<RichEditor id="cm-rules" value={form.rules} onChange={(v) => set({ rules: v })} /></div> : null}
      <div className="fld"><span>{t("ui_community_f_access")}</span>
        <Seg label={t("ui_community_f_access")} value={form.access_mode} onChange={(access_mode) => set({ access_mode })}
          options={[["open", t("ui_community_access_open")], ["request", t("ui_community_access_request")], ["invite", t("ui_community_access_invite")]]} />
        <small className="muted">{accessHints[form.access_mode]}</small>
      </div>
      <div className="fld"><span>{t("ui_community_f_board")}</span>
        <Seg label={t("ui_community_f_board")} value={form.board_mode} onChange={(board_mode) => set({ board_mode })}
          options={[["open", t("ui_community_board_open")], ["admins", t("ui_community_board_admins")]]} />
        <small className="muted">{form.board_mode === "open" ? t("ui_community_board_open_hint") : t("ui_community_board_admins_hint")}</small>
      </div>
    </Modal>
  );
}

// ---------- a community ----------
export function CommunityPage({ id, tab }: { id: number; tab: "board" | "chat" | "agenda" | "members" }) {
  const [c, setC] = useState<Community | null>(null);
  const unread = useStore((s) => (c ? s.conversations[c.conversation_id]?.unread_count ?? 0 : 0));
  const [error, setError] = useState<string | null>(null);
  const [leave, setLeave] = useState(false);
  const [settings, setSettings] = useState(false);
  const [rules, setRules] = useState(false);

  const load = useCallback(() => api.community(id).then((x) => {
    setC(x);
    setError(null);
  }).catch((e) => setError(e.status === 404 || e.status === 403 ? t("ui_community_not_found") : e.message)), [id]);
  useEffect(() => {
    setC(null);
    load();
  }, [load]);

  if (error) {
    return <main className="screen"><div className="swrap"><EmptyState icon="compass" title={error} action={t("ui_board_find_communities")} onAction={() => navigate("/communities")} /></div></main>;
  }
  if (!c) return <main className="screen"><div className="chero shimmer" /><div className="swrap"><span className="sk w60 h18" /></div></main>;

  const globalAdmin = getState().me?.role === "admin";
  const staff = globalAdmin || (!!c.role && STAFF_ROLES.includes(c.role));
  const manager = globalAdmin || c.role === "owner" || c.role === "admin";
  // Board, the community's agenda of plans, and its people; the chat is the real conversation, one button away.
  const tabs: ["board" | "agenda" | "members", string][] = [["board", t("ui_community_tab_board")], ["agenda", t("ui_community_tab_agenda")], ["members", t("ui_community_tab_members")]];
  const openChat = () => navigate(chatPath(c.conversation_id));
  const chatButton = <button className="btn go cchatbtn" onClick={openChat}><Icon name="chat" size="sm" />{t("ui_community_tab_chat")}{unread ? <span className="bdg">{unread > 99 ? "99+" : unread}</span> : null}</button>;

  async function doLeave() {
    try {
      await api.leaveCommunity(id);
      toast(t("ui_community_left_toast"));
      loadMyCommunities();
      await loadConversations().catch(() => undefined);
      load();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  return (
    <main className="screen community">
      <div className="chero" style={{ background: coverGradient("c" + c.id, 120) }}>
        <HeroArt c={c} />
        <div className="herobar">
          <button className="iconbtn glass" onClick={() => goBack("/communities")} aria-label={t("ui_back")}><Icon name="back" /></button>
          <span className="grow" />
          {manager ? <button className="iconbtn glass" onClick={() => setSettings(true)} aria-label={t("ui_community_settings")} title={t("ui_community_settings")}><Icon name="sliders" /></button> : null}
          {c.joined ? <button className="iconbtn glass" onClick={() => setLeave(true)} aria-label={t("ui_community_leave")} title={t("ui_community_leave")}><Icon name="door" /></button> : null}
        </div>
      </div>
      <div className="swrap chead2">
        <div className="row chead2-main" style={{ alignItems: "flex-end", gap: 14 }}>
          <CommunityBadge c={c} size={72} />
          <div className="grow" style={{ minWidth: 0, paddingBottom: 4 }}>
            <h1 className="dtitle" style={{ margin: 0 }}>{c.title}</h1>
            <div className="muted cmetaline">
              {zoneLabel(c)} · {t("ui_members_n", { n: c.member_count })}
              {c.online_count ? <> · <span className="odot" />{t("ui_community_online_n", { n: c.online_count })}</> : null}
            </div>
          </div>
          <span className="deskonly">{c.joined ? chatButton : <JoinButton c={c} onChange={setC} big />}</span>
        </div>
        {c.description ? <p className="cdescfull">{c.description}</p> : null}
        <div className="row chead2-tags" style={{ flexWrap: "wrap" }}>
          {c.access_mode !== "open" ? <span className="ktag"><Icon name="lock" size="sm" />{t(ACCESS_KEYS[c.access_mode])}</span> : null}
          {c.board_mode === "admins" ? <span className="ktag"><Icon name="megaphone" size="sm" />{t("ui_community_board_admins")}</span> : null}
          {c.role ? <span className="ktag k-meetup">{t(ROLE_KEYS[c.role] || "ui_role_member")}</span> : null}
          {c.rules ? <button className="ktag link" onClick={() => setRules(true)}><Icon name="shield" size="sm" />{t("ui_community_rules")}</button> : null}
          <span className="grow" />
          <span className="phoneonly">{c.joined ? chatButton : <JoinButton c={c} onChange={setC} big />}</span>
        </div>
        {c.ban_until ? <div className="bannedbar"><Icon name="shield" size="sm" />{t("ui_you_are_banned", { until: fmtUntil(c.ban_until) })}</div> : null}
        <div className="segtabs ctabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => navigate(communityPath(id, k), true)}>{label}</button>
          ))}
        </div>
      </div>

      {tab === "board" ? <CommunityBoard c={c} staff={staff} /> : null}
      {tab === "agenda" ? <Agenda c={c} /> : null}
      {tab === "chat" ? <CommunityChat c={c} onJoined={setC} /> : null}
      {tab === "members" ? <Members c={c} onChange={load} /> : null}

      {leave ? (
        <ConfirmModal title={t("ui_community_leave")} body={c.role === "owner" ? t("ui_community_leave_owner_body") : t("ui_community_leave_body", { name: c.title })}
          confirm={t("ui_community_leave")} danger onConfirm={doLeave} onClose={() => setLeave(false)} />
      ) : null}
      {settings ? <CommunityFormModal community={c} onClose={() => setSettings(false)} onSaved={(x) => setC({ ...c, ...x })} /> : null}
      {rules ? <Modal title={t("ui_community_rules")} onClose={() => setRules(false)}><div className="rulescard"><RichText text={c.rules || ""} /></div></Modal> : null}
    </main>
  );
}

function CommunityBoard({ c, staff }: { c: Community; staff: boolean }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const params = FILTERS.find(([k]) => k === filter)![2];
  const feed = usePostFeed((before) => api.communityPosts(c.id, { ...params, before_id: before, limit: 20 }), `${c.id}:${filter}`, (ev) => (ev.post?.community.id ?? ev.community_id) === c.id);
  const canPublish = c.joined && (c.board_mode === "open" || staff);
  return (
    <div className="swrap">
      {canPublish ? (
        <button className="composebar" onClick={() => navigate(`/publish?community=${c.id}`)}>
          <span className="cbadge sm" style={{ background: coverGradient("c" + c.id) }}><Icon name="plus" size="sm" /></span>
          <span className="grow">{t("ui_community_publish_prompt", { name: c.title })}</span>
          <span className="btn go sm">{t("ui_nav_publish")}</span>
        </button>
      ) : c.joined ? (
        <div className="lockline"><Icon name="lock" size="sm" />{t("ui_community_board_readonly")}</div>
      ) : null}
      <FilterChips value={filter} onChange={setFilter} />
      <PostList feed={feed} showCommunity={false} empty={
        canPublish
          ? <EmptyState icon="layers" title={t("ui_community_board_empty")} body={t("ui_community_board_empty_body")} action={t("ui_board_publish_plan")} onAction={() => navigate(`/publish?community=${c.id}`)} />
          : <EmptyState icon="layers" title={t("ui_community_board_empty")} body={!c.joined ? t("ui_community_join_to_see") : undefined} />
      } />
    </div>
  );
}

/** An old link to a community's chat: members go to the conversation itself; others are asked to join first. */
function CommunityChat({ c, onJoined }: { c: Community; onJoined: (c: Community) => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (c.joined) navigate(chatPath(c.conversation_id), true);
  }, [c.joined, c.conversation_id]);
  if (c.joined) return null;
  return (
    <div className="swrap">
      <EmptyState icon="chat" title={t("ui_community_chat_join_title")} body={t("ui_community_chat_join_body")}
        action={c.access_mode === "open" ? t("ui_join") : c.access_mode === "request" && !c.request_pending ? t("ui_community_ask_join") : undefined}
        onAction={async () => {
          if (busy) return;
          setBusy(true);
          const next = await joinCommunity(c);
          setBusy(false);
          if (next) onJoined(next);
        }} />
    </div>
  );
}

/** The community's agenda: its coming meetups and events, day by day. */
function Agenda({ c }: { c: Community }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  useEffect(() => {
    setPosts(null);
    api.communityPosts(c.id, { when: "upcoming", limit: 50 }).then((r) => setPosts(r.posts.filter((p) => p.starts_at))).catch(() => setPosts([]));
  }, [c.id]);
  if (posts === null) return <div className="swrap"><div className="muted">{t("ui_loading")}</div></div>;
  if (!posts.length) {
    return (
      <div className="swrap">
        <EmptyState icon="calendar" title={t("ui_agenda_empty_title")} body={t("ui_agenda_empty_body")}
          action={c.joined ? t("ui_board_publish_plan") : undefined} onAction={() => navigate(`/publish?community=${c.id}`)} />
      </div>
    );
  }
  const days: { key: string; label: string; items: Post[] }[] = [];
  for (const p of posts) {
    const d = new Date(p.starts_at!);
    const key = d.toDateString();
    let day = days.find((x) => x.key === key);
    if (!day) {
      day = { key, label: d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }), items: [] };
      days.push(day);
    }
    day.items.push(p);
  }
  return (
    <div className="swrap agenda">
      {days.map((day) => (
        <section key={day.key} className="agenda-day">
          <h3 className="agenda-date">{day.label}</h3>
          <div className="stack" style={{ gap: 10 }}>
            {day.items.map((p) => <PostCard key={p.id} post={p} showCommunity={false} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The cover: the hobby's icon scattered over the community's colours, with soft light. Always the same per community. */
function HeroArt({ c }: { c: Community }) {
  const icon = hobbyIcon(c.slug, c.title);
  let seed = c.id * 9301 + 49297;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const marks = Array.from({ length: 26 }, (_, i) => {
    const col = i % 13;
    const row = Math.floor(i / 13);
    return { left: col * 7.8 + rnd() * 4 - 1, top: row * 50 + rnd() * 30 - 6, size: 26 + rnd() * 40, rot: rnd() * 50 - 25, op: 0.1 + rnd() * 0.22 };
  });
  return (
    <span className="chero-art" aria-hidden="true">
      {marks.map((m, i) => (
        <span key={i} className="chero-mark" style={{ left: `${m.left}%`, top: `${m.top}%`, width: m.size, height: m.size, transform: `rotate(${m.rot}deg)`, opacity: m.op }}>
          <Icon name={icon} />
        </span>
      ))}
    </span>
  );
}

/** "Mon 24, 18:30" in the person's language, for the end of a ban. */
export function fmtUntil(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function Members({ c, onChange }: { c: Community; onChange: () => void }) {
  const me = useStore((s) => s.me);
  const [q, setQ] = useState("");
  const [list, setList] = useState<CommunityMember[] | null>(null);
  const [requests, setRequests] = useState<{ user: UserSummary; created_at: string }[]>([]);
  const [invite, setInvite] = useState<string | null>(c.invite_code ? `${window.location.origin}/app/join/${c.invite_code}` : null);
  const [manage, setManage] = useState<CommunityMember | null>(null);
  // MeetGo's administrators manage every community as if they were its owner.
  const globalAdmin = me?.role === "admin";
  const staff = globalAdmin || (!!c.role && STAFF_ROLES.includes(c.role));
  // Invitations, join requests and lifting bans: owner and admins (people linked to bot-admin).
  const isAdmin = globalAdmin || c.role === "owner" || c.role === "admin";
  const myRank = me?.role === "admin" ? 4 : RANK[c.role || "member"] ?? 0;
  const [bans, setBans] = useState<{ user: UserSummary; forever: boolean; until: string | null; strikes: number }[]>([]);

  const load = useCallback(() => {
    api.communityMembers(c.id, q.trim()).then(setList).catch(() => setList([]));
  }, [c.id, q]);
  useEffect(() => {
    const id = window.setTimeout(load, q ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);
  const loadRequests = useCallback(() => {
    if (isAdmin) api.communityRequests(c.id).then(setRequests).catch(() => setRequests([]));
  }, [c.id, isAdmin]);
  useEffect(loadRequests, [loadRequests]);
  const loadBans = useCallback(() => {
    if (staff) api.communityBans(c.id).then(setBans).catch(() => setBans([]));
  }, [c.id, staff]);
  useEffect(loadBans, [loadBans]);

  async function banFor(m: { id: number; display_name: string }, hours: number | null) {
    const ask = hours ? t("ui_ban_confirm_hours", { name: m.display_name, hours }) : `${t("ui_community_ban_member")}: ${m.display_name}\n${t("ui_community_ban_hint")}`;
    if (!window.confirm(ask)) return;
    try {
      await api.banCommunityMember(c.id, m.id, hours);
      toast(t("ui_banned_toast", { name: m.display_name }));
      load();
      loadBans();
      onChange();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function unban(m: { id: number; display_name: string }) {
    try {
      await api.unbanCommunityMember(c.id, m.id);
      toast(t("ui_unbanned_toast", { name: m.display_name }));
      load();
      loadBans();
      onChange();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  async function resolve(userId: number, accept: boolean) {
    try {
      await api.resolveCommunityRequest(c.id, userId, accept);
      toast(accept ? t("ui_community_request_accepted") : t("ui_community_request_rejected"));
      loadRequests();
      if (accept) {
        load();
        onChange();
      }
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function newInvite() {
    try {
      const r = await api.communityInvite(c.id);
      setInvite(r.url || `${window.location.origin}/app/join/${r.code}`);
      toast(t("ui_community_invite_new_toast"));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function setRole(m: CommunityMember, role: string) {
    try {
      await api.setCommunityRole(c.id, m.id, role);
      toast(t("ui_community_role_changed", { name: m.display_name }));
      load();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function remove(m: CommunityMember, ban = false) {
    const ask = `${t(ban ? "ui_community_ban_member" : "ui_community_remove_member")}: ${m.display_name}\n${t(ban ? "ui_community_ban_hint" : "ui_community_remove_hint")}`;
    if (!window.confirm(ask)) return;
    try {
      await api.removeCommunityMember(c.id, m.id, ban);
      toast(t(ban ? "ui_community_member_banned" : "ui_community_member_removed", { name: m.display_name }));
      load();
      onChange();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  const sorted = useMemo(() => [...(list || [])].sort((a, b) => Number(!!b.bot) - Number(!!a.bot) || (RANK[b.role] ?? 0) - (RANK[a.role] ?? 0) || Number(b.online) - Number(a.online) || a.display_name.localeCompare(b.display_name)), [list]);
  // Owner names admins; owner and admins name moderators; only above someone's rank can you change or remove them.
  const roleOptions = (m: CommunityMember) => (globalAdmin || c.role === "owner" ? ["admin", "moderator", "member"] : c.role === "admin" ? ["moderator", "member"] : []).filter(() => !m.bot && m.id !== me?.id && (RANK[m.role] ?? 0) < myRank);

  return (
    <div className="swrap stack" style={{ gap: 14 }}>
      {isAdmin && requests.length ? (
        <section className="box">
          <h3 className="boxtitle">{t("ui_community_requests_n", { n: requests.length })}</h3>
          <div className="plist">
            {requests.map((r) => (
              <div key={r.user.id} className="item">
                <Avatar user={r.user} size={36} />
                <span className="grow">{r.user.display_name}</span>
                <button className="btn sm pri" onClick={() => resolve(r.user.id, true)}>{t("ui_accept")}</button>
                <button className="btn sm" onClick={() => resolve(r.user.id, false)}>{t("ui_decline")}</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {staff && bans.length ? (
        <section className="box">
          <h3 className="boxtitle">{t("ui_bans_title", { n: bans.length })}</h3>
          <div className="plist">
            {bans.map((b) => (
              <div key={b.user.id} className="item">
                <Avatar user={b.user} size={36} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{b.user.display_name}</div>
                  <div className="banned-note">{b.forever ? t("ui_banned_forever") : t("ui_banned_until", { until: fmtUntil(b.until) })}</div>
                </div>
                {isAdmin ? <button className="btn sm" onClick={() => unban(b.user)}>{t("ui_unban")}</button> : null}
              </div>
            ))}
          </div>
          {!isAdmin ? <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>{t("ui_unban_admins_only")}</p> : null}
        </section>
      ) : null}
      {isAdmin ? (
        <section className="box stack">
          <h3 className="boxtitle">{t("ui_invite_link")}</h3>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("ui_community_invite_hint")}</p>
          {invite ? (
            <div className="copyrow">
              <input id="cm-invite" className="inp" readOnly value={invite} onFocus={(e) => e.target.select()} />
              <button className="btn" onClick={() => navigator.clipboard?.writeText(invite).then(() => toast(t("ui_copied"))).catch(() => undefined)}><Icon name="copy" size="sm" />{t("ui_copy")}</button>
            </div>
          ) : null}
          <div><button className="btn sm" onClick={newInvite}><Icon name="repeat" size="sm" />{invite ? t("ui_community_invite_new") : t("ui_community_invite_create")}</button></div>
        </section>
      ) : null}
      <section className="box">
        <div className="search" style={{ marginBottom: 6 }}>
          <Icon name="search" size="sm" />
          <input id="cm-members-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_search_members")} />
        </div>
        {list === null ? <div className="muted" style={{ padding: 8 }}>{t("ui_loading")}</div> : null}
        {list && !list.length ? <div className="muted" style={{ padding: 8 }}>{q ? t("ui_no_results") : t("ui_community_no_members")}</div> : null}
        <div className="plist">
          {sorted.map((m) => {
            const opts = roleOptions(m);
            const canRemove = staff && !m.bot && m.id !== me?.id && (RANK[m.role] ?? 0) < myRank;
            const linked = m.role === "admin" ? "@bot-admin" : m.role === "moderator" ? "@bot-moderator" : null;
            return (
              <div key={m.id} className={"item" + (m.bot ? " botrow" : "")}>
                {m.bot ? <span className="botav" aria-hidden="true">🤖</span> : <Avatar user={m} size={36} online={m.online} />}
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>{m.bot ? "@" + m.display_name : m.display_name}</span>
                    {m.bot ? <span className="role bot">{t("ui_bot_label")}</span> : null}
                    {m.role !== "member" ? <span className="role">{t(ROLE_KEYS[m.role])}</span> : null}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {m.bot ? t(m.role === "admin" ? "ui_bot_admin_hint" : "ui_bot_moderator_hint")
                      : m.ban_until ? <span className="banned-note">{t("ui_banned_until", { until: fmtUntil(m.ban_until) })}</span>
                      : linked && !m.bot ? t("ui_bot_linked", { bot: linked })
                      : m.online ? t("ui_online") : t("ui_offline")}
                  </div>
                </div>
                {m.ban_until && isAdmin ? <button className="btn sm" onClick={() => unban(m)}>{t("ui_unban")}</button> : null}
                {canRemove && !m.ban_until ? <button className="btn sm danger" onClick={() => setManage(m)}><Icon name="shield" size="sm" />{t("ui_ban_title")}</button> : null}
                {opts.length || canRemove ? <button className="iconbtn" title={t("ui_community_manage")} aria-label={t("ui_community_manage")} onClick={() => setManage(m)}><Icon name="sliders" size="sm" /></button> : null}
              </div>
            );
          })}
        </div>
      </section>
      {manage ? (
        <Modal title={manage.display_name} onClose={() => setManage(null)}>
          <div className="row" style={{ gap: 12 }}><Avatar user={manage} size={48} /><div className="muted">{t(ROLE_KEYS[manage.role])}</div></div>
          {roleOptions(manage).length ? (
            <label className="fld">{t("ui_community_change_role")}
              <select id="cm-manage-role" className="inp" value={manage.role} onChange={(e) => { setRole(manage, e.target.value); setManage({ ...manage, role: e.target.value as CommunityMember["role"] }); }}>
                {!roleOptions(manage).includes(manage.role) ? <option value={manage.role}>{t(ROLE_KEYS[manage.role])}</option> : null}
                {roleOptions(manage).map((r) => <option key={r} value={r}>{t(ROLE_KEYS[r])}</option>)}
              </select>
            </label>
          ) : null}
          {manage.id !== me?.id && (RANK[manage.role] ?? 0) < myRank ? (
            <div className="stack" style={{ gap: 8 }}>
              <h4 className="boxtitle" style={{ margin: "6px 0 0" }}>{t("ui_ban_title")}</h4>
              <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_ban_hint")}</div>
              <div className="banbtns">
                {[6, 24, 24 * 7].map((h) => <button key={h} className="btn" onClick={() => { banFor(manage, h); setManage(null); }}>{t(h === 6 ? "ui_ban_6h" : h === 24 ? "ui_ban_24h" : "ui_ban_7d")}</button>)}
              </div>
              <button className="btn danger block" onClick={() => { banFor(manage, null); setManage(null); }}><Icon name="shield" size="sm" />{t("ui_ban_forever")}</button>
              <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_community_ban_hint")}</div>
              <button className="btn block" style={{ marginTop: 6 }} onClick={() => { remove(manage); setManage(null); }}><Icon name="door" size="sm" />{t("ui_community_remove_member")}</button>
              <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_community_remove_hint")}</div>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}

/** Home: the communities I belong to, one tap away (board, chat and members). */

