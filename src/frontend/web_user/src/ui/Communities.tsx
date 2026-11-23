// Communities of my zone: the list, creating one, and a community's page (board, chat and members).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@lang";
import { api, fileUrl } from "../api";
import { coverGradient } from "../board";
import { communityPath, goBack, navigate } from "../router";
import { getState, loadConversations, loadMyCommunities, setState, toast, useStore } from "../store";
import type { AccessMode, BoardMode, Community, CommunityMember, UserSummary } from "../types";
import { ChatView } from "./Chat";
import { Avatar, Icon, Modal, hobbyIcon } from "./common";
import { RichEditor, RichText } from "./RichText";
import { ConfirmModal, EmptyState, FilterChips, FILTERS, type FilterKey, PhoneTop, PostList, STAFF_ROLES, Seg, usePostFeed } from "./Board";

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

export function CommunitiesPage() {
  const me = useStore((s) => s.me);
  const [q, setQ] = useState("");
  const [list, setList] = useState<Community[] | null>(null);
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
  const mine = (list || []).filter((c) => c.joined);
  const others = (list || []).filter((c) => !c.joined);

  return (
    <main className="screen">
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
            {others.length ? <><div className="lsec">{t("ui_community_discover")}</div><div className="cgrid">{others.map((c) => <CommunityCard key={c.id} c={c} onChange={update} />)}</div></> : null}
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
export function CommunityPage({ id, tab }: { id: number; tab: "board" | "chat" | "members" }) {
  const [c, setC] = useState<Community | null>(null);
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

  const staff = !!c.role && STAFF_ROLES.includes(c.role);
  const manager = c.role === "owner" || c.role === "admin";
  const tabs: ["board" | "chat" | "members", string][] = [["board", t("ui_community_tab_board")], ["chat", t("ui_community_tab_chat")], ["members", t("ui_community_tab_members")]];

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
    <main className={"screen community" + (tab === "chat" && c.joined ? " withchat" : "")}>
      <div className="chero" style={{ background: coverGradient("c" + c.id, 120) }}>
        <span className="chero-art" aria-hidden="true"><Icon name={hobbyIcon(c.slug, c.title)} /><Icon name={hobbyIcon(c.slug, c.title)} /><Icon name={hobbyIcon(c.slug, c.title)} /></span>
        <div className="herobar">
          <button className="iconbtn glass" onClick={() => goBack("/communities")} aria-label={t("ui_back")}><Icon name="back" /></button>
          <span className="grow" />
          {manager ? <button className="iconbtn glass" onClick={() => setSettings(true)} aria-label={t("ui_community_settings")} title={t("ui_community_settings")}><Icon name="sliders" /></button> : null}
          {c.joined ? <button className="iconbtn glass" onClick={() => setLeave(true)} aria-label={t("ui_community_leave")} title={t("ui_community_leave")}><Icon name="door" /></button> : null}
        </div>
      </div>
      <div className="swrap chead2">
        <div className="row" style={{ alignItems: "flex-end", gap: 14 }}>
          <CommunityBadge c={c} size={72} />
          <div className="grow" style={{ minWidth: 0, paddingBottom: 4 }}>
            <h1 className="dtitle" style={{ margin: 0 }}>{c.title}</h1>
            <div className="muted cmetaline">
              {zoneLabel(c)} · {t("ui_members_n", { n: c.member_count })}
              {c.online_count ? <> · <span className="odot" />{t("ui_community_online_n", { n: c.online_count })}</> : null}
            </div>
          </div>
          <span className="deskonly"><JoinButton c={c} onChange={setC} big /></span>
        </div>
        {c.description ? <p className="cdescfull">{c.description}</p> : null}
        <div className="row" style={{ flexWrap: "wrap" }}>
          {c.access_mode !== "open" ? <span className="ktag"><Icon name="lock" size="sm" />{t(ACCESS_KEYS[c.access_mode])}</span> : null}
          {c.board_mode === "admins" ? <span className="ktag"><Icon name="megaphone" size="sm" />{t("ui_community_board_admins")}</span> : null}
          {c.role ? <span className="ktag k-meetup">{t(ROLE_KEYS[c.role] || "ui_role_member")}</span> : null}
          {c.rules ? <button className="ktag link" onClick={() => setRules(true)}><Icon name="shield" size="sm" />{t("ui_community_rules")}</button> : null}
          <span className="grow" />
          {!c.joined ? <span className="phoneonly"><JoinButton c={c} onChange={setC} big /></span> : null}
        </div>
        <div className="segtabs ctabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => navigate(communityPath(id, k), true)}>{label}</button>
          ))}
        </div>
      </div>

      {tab === "board" ? <CommunityBoard c={c} staff={staff} /> : null}
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

function CommunityChat({ c, onJoined }: { c: Community; onJoined: (c: Community) => void }) {
  const known = useStore((s) => !!s.conversations[c.conversation_id]);
  const [busy, setBusy] = useState(false);
  // The chat room counts as open (no unread badge) while it is on screen.
  useEffect(() => {
    if (!c.joined) return;
    setState({ activeConversation: c.conversation_id });
    return () => {
      if (getState().activeConversation === c.conversation_id) setState({ activeConversation: null });
    };
  }, [c.joined, c.conversation_id]);
  useEffect(() => {
    if (c.joined && !known) loadConversations().catch(() => undefined);
  }, [c.joined, known]);

  if (!c.joined) {
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
  if (!known) return <div className="swrap"><div className="muted">{t("ui_loading")}</div></div>;
  return <div className="embedchat"><ChatView key={c.conversation_id} conversationId={c.conversation_id} around={null} embedded /></div>;
}

function Members({ c, onChange }: { c: Community; onChange: () => void }) {
  const me = useStore((s) => s.me);
  const [q, setQ] = useState("");
  const [list, setList] = useState<CommunityMember[] | null>(null);
  const [requests, setRequests] = useState<{ user: UserSummary; created_at: string }[]>([]);
  const [invite, setInvite] = useState<string | null>(c.invite_code ? `${window.location.origin}/app/join/${c.invite_code}` : null);
  const [removeFor, setRemoveFor] = useState<CommunityMember | null>(null);
  const staff = !!c.role && STAFF_ROLES.includes(c.role);
  const myRank = RANK[c.role || "member"] ?? 0;

  const load = useCallback(() => {
    api.communityMembers(c.id, q.trim()).then(setList).catch(() => setList([]));
  }, [c.id, q]);
  useEffect(() => {
    const id = window.setTimeout(load, q ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);
  const loadRequests = useCallback(() => {
    if (staff) api.communityRequests(c.id).then(setRequests).catch(() => setRequests([]));
  }, [c.id, staff]);
  useEffect(loadRequests, [loadRequests]);

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
  async function remove(m: CommunityMember) {
    try {
      await api.removeCommunityMember(c.id, m.id);
      toast(t("ui_community_member_removed", { name: m.display_name }));
      load();
      onChange();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  const sorted = useMemo(() => [...(list || [])].sort((a, b) => (RANK[b.role] ?? 0) - (RANK[a.role] ?? 0) || Number(b.online) - Number(a.online) || a.display_name.localeCompare(b.display_name)), [list]);
  // Owner names admins; owner and admins name moderators; only above someone's rank can you change or remove them.
  const roleOptions = (m: CommunityMember) => (c.role === "owner" ? ["admin", "moderator", "member"] : c.role === "admin" ? ["moderator", "member"] : []).filter(() => m.id !== me?.id && (RANK[m.role] ?? 0) < myRank);

  return (
    <div className="swrap stack" style={{ gap: 14 }}>
      {staff && requests.length ? (
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
      {staff ? (
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
            const canRemove = staff && m.id !== me?.id && (RANK[m.role] ?? 0) < myRank;
            return (
              <div key={m.id} className="item">
                <Avatar user={m} size={36} online={m.online} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>{m.display_name}</span>
                    {m.role !== "member" ? <span className="role">{t(ROLE_KEYS[m.role])}</span> : null}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{m.online ? t("ui_online") : t("ui_offline")}</div>
                </div>
                {opts.length ? (
                  <select className="inp rolesel" aria-label={t("ui_community_change_role")} value={m.role} onChange={(e) => setRole(m, e.target.value)}>
                    {!opts.includes(m.role) ? <option value={m.role}>{t(ROLE_KEYS[m.role])}</option> : null}
                    {opts.map((r) => <option key={r} value={r}>{t(ROLE_KEYS[r])}</option>)}
                  </select>
                ) : null}
                {canRemove ? <button className="iconbtn" aria-label={t("ui_remove")} title={t("ui_remove")} onClick={() => setRemoveFor(m)}><Icon name="x" size="sm" /></button> : null}
              </div>
            );
          })}
        </div>
      </section>
      {removeFor ? (
        <ConfirmModal title={t("ui_remove")} body={t("ui_community_remove_body", { name: removeFor.display_name })} confirm={t("ui_remove")} danger
          onConfirm={() => remove(removeFor)} onClose={() => setRemoveFor(null)} />
      ) : null}
    </div>
  );
}
