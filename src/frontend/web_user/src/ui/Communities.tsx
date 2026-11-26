// Communities of my zone: the list, creating one, and a community's page (board, chat and members).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LANGUAGES, getLang, t } from "@lang";
import { api, fileUrl } from "../api";
import { coverGradient } from "../board";
import { chatPath, communityPath, goBack, navigate } from "../router";
import { getState, loadConversations, loadMyCommunities, setState, toast, useStore } from "../store";
import type { AccessMode, BoardMode, Community, CommunityMember, CommunityStats, Post, UserSummary } from "../types";
import { Avatar, Icon, Modal, communityCover, hobbyIcon, interestLook } from "./common";
import { RichEditor, RichText } from "./RichText";
import { ConfirmModal, EmptyState, FilterChips, FILTERS, type FilterKey, PhoneTop, PostCard, PostList, STAFF_ROLES, Seg, Skeletons, usePostFeed } from "./Board";

const ACCESS_KEYS: Record<AccessMode, string> = { open: "ui_community_access_open", request: "ui_community_access_request", invite: "ui_community_access_invite" };
const ROLE_KEYS: Record<string, string> = { owner: "ui_role_owner", admin: "ui_role_admin", moderator: "ui_role_moderator", member: "ui_role_member" };
const RANK: Record<string, number> = { owner: 3, admin: 2, moderator: 1, member: 0 };

function CommunityBadge({ c, size = 52 }: { c: Community; size?: number }) {
  if (c.avatar_url) return <img className="cbadge" src={fileUrl(c.avatar_url)} alt="" style={{ width: size, height: size }} />;
  return (
    <span className="cbadge" style={{ width: size, height: size, background: communityCover(c.slug, "c" + c.id) }} aria-hidden="true">
      <Icon name={hobbyIcon(c.slug, c.title)} className="cbadge-ic" />
    </span>
  );
}

/** Join, ask to join, or the state I am in. Returns the new community state. */
async function joinCommunity(c: Community, answers?: string[]): Promise<Community | null> {
  try {
    const { status } = await api.joinCommunity(c.id, answers);
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
  const [asking, setAsking] = useState(false);
  const cls = "btn " + (big ? "" : "sm ");
  if (c.joined) return <button className={cls + "pri"} onClick={(e) => { e.stopPropagation(); navigate(communityPath(c.id)); }}>{t("ui_open")}</button>;
  if (c.my_zone === false) return <span className="spill"><Icon name="place" size="sm" />{t("ui_zone_other")}</span>;
  if (c.request_pending) return <span className="spill wait">{t("ui_community_requested")}</span>;
  if (c.access_mode === "invite") return <span className="spill"><Icon name="lock" size="sm" />{t("ui_community_access_invite")}</span>;
  const questions = c.access_mode === "request" ? c.join_questions || [] : [];
  return (
    <>
      <button className={cls + "go"} disabled={busy} onClick={async (e) => {
        e.stopPropagation();
        if (questions.length) return setAsking(true);
        setBusy(true);
        const next = await joinCommunity(c);
        setBusy(false);
        if (next) onChange(next);
      }}>{c.access_mode === "request" ? t("ui_community_ask_join") : t("ui_join")}</button>
      {asking ? <JoinQuestionsModal c={c} onClose={() => setAsking(false)} onDone={(next) => { setAsking(false); onChange(next); }} /> : null}
    </>
  );
}

/** A community that needs approval asks its questions first; the answers go with the request. */
function JoinQuestionsModal({ c, onClose, onDone }: { c: Community; onClose: () => void; onDone: (c: Community) => void }) {
  const questions = c.join_questions || [];
  const [answers, setAnswers] = useState<string[]>(questions.map(() => ""));
  const [busy, setBusy] = useState(false);
  const ready = answers.every((a) => a.trim());
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Modal title={t("ui_community_ask_join")} onClose={onClose} footer={<>
        <button className="btn" onClick={onClose}>{t("ui_cancel")}</button>
        <button className="btn go" disabled={busy || !ready} onClick={async () => {
          setBusy(true);
          const next = await joinCommunity(c, answers.map((a) => a.trim()));
          setBusy(false);
          if (next) onDone(next);
        }}>{t("ui_community_send_request")}</button>
      </>}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("ui_community_questions_lead", { name: c.title })}</p>
        {questions.map((q, i) => (
          <label key={i} className="fld">{q}
            <textarea id={`cm-answer-${i}`} className="inp" rows={2} maxLength={500} value={answers[i]} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} />
          </label>
        ))}
      </Modal>
    </span>
  );
}

function CommunityCard({ c, onChange }: { c: Community; onChange: (c: Community) => void }) {
  const browse = useStore((s) => s.browseZone);
  const wide = !!browse && !browse.province;  // several provinces: say which one each community is in
  return (
    <article className={"ccard" + (c.my_zone === false ? " otherzone" : "")} role="link" tabIndex={0}
      onClick={() => c.my_zone !== false && navigate(communityPath(c.id))} onKeyDown={(e) => e.key === "Enter" && c.my_zone !== false && navigate(communityPath(c.id))}>
      {/* the hobby's silhouette as a soft watermark, tinted with the community's colours */}
      <span className="cwm" style={{ background: communityCover(c.slug, "c" + c.id) }} aria-hidden="true"><Icon name={hobbyIcon(c.slug, c.title)} /></span>
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
        <div className="row ctags">
          <ScopeTags c={c} />
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
  ["ui_cat_social", /tomar|caf[eé]|cerve|beer|copa|drink|picnic|network|gastro|comida|cena|food|tapas|fiesta|party|amig|friend/],
  ["ui_cat_sports", /deport|sport|balonc|basket|futbol|fútbol|football|soccer|tenis|tennis|padel|pádel|fitness|crossfit|gym|cicl|bici|bike|mtb|run|correr|nata|swim|surf|yoga/],
  ["ui_cat_nature", /sender|hik|trek|monta|mountain|playa|beach|viaj|travel|natur|camp/],
  ["ui_cat_culture", /cine|film|movie|lect|libro|book|read|m[uú]sic|music|concier|concert|rock|flamenc|arte|art|foto|photo|teatro|theat/],
  ["ui_cat_education", /aprend|idioma|ingl[eé]s|alem[aá]n|franc[eé]s|learn|language|educa|curso|course/],
  ["ui_cat_skills", /cocina|cook|guitar|bater[ií]a|drum|teclado|keyboard|piano|baile|danc/],
  ["ui_cat_motor", /coche|car\b|auto|moto/],
  ["ui_cat_opinion", /econom|pol[ií]tic|opini|debate|actualidad|news/],
];

/** The category keys, in the order the lists show them: the built-in ones until the server's list arrives (then the
 * same array is updated, so every import sees it). */
export const CATEGORY_KEYS: string[] = [...CATEGORIES.map(([k]) => k), "ui_cat_other"];
const CATEGORY_NAMES: Record<string, string> = {};

export function setCategories(list: { key: string; name: string }[]) {
  if (!list.length) return;
  CATEGORY_KEYS.splice(0, CATEGORY_KEYS.length, ...list.map((c) => c.key));
  for (const k of Object.keys(CATEGORY_NAMES)) delete CATEGORY_NAMES[k];
  for (const c of list) CATEGORY_NAMES[c.key] = c.name;
}

/** A category's name in the reader's language (the server's, or the translation of a built-in one). */
export const categoryName = (key: string) => CATEGORY_NAMES[key] || t(key);

export function communityCategory(c: Community): string {
  const own = (c as Community & { category?: string | null }).category || interestLook(c.slug).category;
  if (own && CATEGORY_KEYS.includes(own)) return own;
  return guessCategory(c.slug, c.title);
}

/** The category that fits the name, whatever was chosen in the administration. */
export function guessCategory(slug?: string | null, title?: string | null): string {
  const text = `${slug || ""} ${title || ""}`.toLowerCase();
  return CATEGORIES.find(([, re]) => re.test(text))?.[0] || "ui_cat_other";
}

const byTitle = (a: Community, b: Community) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

/** The communities by category (in the order above, "Other" last), each in alphabetical order. */
function byCategory(list: Community[]): [string, Community[]][] {
  const order = CATEGORY_KEYS;
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

  const browse = useStore((s) => s.browseZone);
  const load = useCallback((query: string) => {
    setError(null);
    api.communities({ q: query || undefined, ...(browse ? { country: browse.country, area: browse.area, province: browse.province, age_range: browse.age_range } : {}) }).then(setList).catch((e) => {
      setList([]);
      if (e?.status !== 404) setError(e.message);
    });
  }, [browse]);
  useEffect(() => {
    const id = window.setTimeout(() => load(q.trim()), q ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [q, load]);

  const update = (c: Community) => setList((xs) => xs?.map((x) => (x.id === c.id ? c : x)) || null);
  const notMine = (list || []).filter((c) => !c.joined).length;
  // All of them, the ones I run (if any), the ones I joined (Open, blue) or the ones I have not joined (Join, green);
  // remembered on this device.
  type Show = "all" | "created" | "mine" | "new";
  const [show, setShowState] = useState<Show>(() => {
    try {
      const v = localStorage.getItem("communities.show");
      if (v === "all" || v === "created" || v === "mine" || v === "new") return v;
      return localStorage.getItem("communities.showOthers") === "0" ? "mine" : "all";
    } catch {
      return "all";
    }
  });
  const setShow = (v: Show) => {
    setShowState(v);
    try {
      localStorage.setItem("communities.show", v);
    } catch {
      /* per device */
    }
  };
  // the ones I run: created by me or where I am a co-administrator
  const created = (c: Community) => c.joined && (c.role === "owner" || c.role === "admin");
  const createdCount = (list || []).filter(created).length;
  const mineCount = (list || []).length - notMine - createdCount;
  // without communities of my own, that tab is not there: its place goes back to all of them
  const view: Show = show === "created" && !createdCount ? "all" : show;
  // two switches on top of the tabs: only those created in the last 30 days, only MeetGo's own (interest) ones
  const [flags, setFlagsState] = useState<{ fresh: boolean; builtin: boolean }>(() => {
    try {
      return { fresh: false, builtin: false, ...JSON.parse(localStorage.getItem("communities.flags") || "{}") };
    } catch {
      return { fresh: false, builtin: false };
    }
  });
  const setFlag = (k: "fresh" | "builtin", v: boolean) => setFlagsState((f) => {
    const next = { ...f, [k]: v };
    try {
      localStorage.setItem("communities.flags", JSON.stringify(next));
    } catch {
      /* per device */
    }
    return next;
  });
  const monthAgo = Date.now() - 30 * 86400e3;
  useStore((s) => s.categories);  // re-drawn when the categories' names arrive
  const shown = (list || []).filter((c) => browse || view === "all"
    || (view === "created" ? created(c) : view === "mine" ? c.joined && !created(c) : !c.joined))
    .filter((c) => (!flags.fresh || new Date(c.created_at).getTime() >= monthAgo) && (!flags.builtin || c.kind === "interest"));
  const groups = byCategory(shown);

  return (
    <main className="screen" ref={scroller} onScroll={(e) => { listMemory.scroll = e.currentTarget.scrollTop; }}>
      <PhoneTop title={t("ui_nav_communities")} />
      <div className="swrap wide">
        <header className="shead">
          <div className="grow">
            <h1 className="deskonly">{t("ui_community_title")}</h1>
            <p className="muted">{me ? t("ui_community_lead", { zone: browse?.label || me.province }) : null}</p>
          </div>
          <button className="btn go" onClick={() => setCreate(true)}><Icon name="plus" size="sm" />{t("ui_community_create")}</button>
        </header>
        <div className="search big">
          <Icon name="search" size="sm" />
          <input id="community-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_community_search_ph")} aria-label={t("ui_community_search_ph")} />
          {q ? <button className="iconbtn" style={{ width: 26, height: 26 }} onClick={() => setQ("")} aria-label={t("ui_clear")}><Icon name="x" size="sm" /></button> : null}
        </div>
        {browse ? (
          <div className="zonebar">
            <Icon name="place" size="sm" />
            <span className="grow">{t("ui_zone_browsing", { zone: `${browse.label} · ${browse.age_range.replace("_plus", "+").replace("_", "-")}` })}</span>
            <button className="btn sm" onClick={() => setState({ browseZone: null })}>{t("ui_zone_back_mine")}</button>
          </div>
        ) : null}
        {list && list.length && !browse ? (
          <div className={`segtabs cfilter${createdCount ? " c4" : ""}`} role="tablist" aria-label={t("ui_nav_communities")}>
            {([["all", t("ui_cshow_all"), t("ui_cshow_all"), list.length],
              ...(createdCount ? [["created", t("ui_cshow_created"), t("ui_cshow_created_short"), createdCount]] : []),
              ["mine", t("ui_cshow_joined"), t("ui_cshow_joined_short"), mineCount],
              ["new", t("ui_cshow_new"), t("ui_cshow_new"), notMine]] as [Show, string, string, number][]).map(([k, label, short, n]) => (
              <button key={k} id={`communities-show-${k}`} role="tab" aria-selected={view === k} aria-label={`${label} ${n}`} className={view === k ? "on" : ""} onClick={() => setShow(k)}>
                <span className="cfl">{label}</span><span className="cfs">{short}</span> <span className="cfn">{n}</span>
              </button>
            ))}
          </div>
        ) : null}

        {list && list.length ? (
          <div className="cflags">
            <label className="cflag" htmlFor="communities-fresh">
              <input id="communities-fresh" type="checkbox" role="switch" checked={flags.fresh} onChange={(e) => setFlag("fresh", e.target.checked)} />
              <span className="sw" aria-hidden="true" />{t("ui_cflag_new")}
            </label>
            <label className="cflag" htmlFor="communities-builtin">
              <input id="communities-builtin" type="checkbox" role="switch" checked={flags.builtin} onChange={(e) => setFlag("builtin", e.target.checked)} />
              <span className="sw" aria-hidden="true" />{t("ui_cflag_default")}
            </label>
          </div>
        ) : null}
        {list === null ? (
          <div className="cgrid">{[0, 1, 2, 3].map((i) => <div key={i} className="ccard skel"><div className="ccover shimmer" /><div className="cbody"><span className="sk w60 h18" /><span className="sk w80" /></div></div>)}</div>
        ) : error ? (
          <EmptyState icon="info" title={t("ui_board_error")} body={error} action={t("ui_board_retry")} onAction={() => load(q.trim())} />
        ) : !list.length && browse ? (
          <EmptyState icon="compass" title={q ? t("ui_no_results") : t("ui_zone_nobody", { zone: browse.label })} action={t("ui_zone_back_mine")} onAction={() => setState({ browseZone: null })} />
        ) : !list.length ? (
          q ? <EmptyState icon="search" title={t("ui_no_results")} body={t("ui_community_no_match")} action={t("ui_community_create")} onAction={() => setCreate(true)} />
            : <EmptyState icon="compass" title={t("ui_community_empty_title")} body={t("ui_community_empty_body")} action={t("ui_community_create")} onAction={() => setCreate(true)} />
        ) : (
          <>
            {groups.map(([cat, items]) => (
              <section key={cat} className="ccat">
                <div className="lsec ccat-title">{categoryName(cat)} <span className="muted">· {items.length}</span></div>
                <div className="cgrid">{items.map((c) => <CommunityCard key={c.id} c={c} onChange={update} />)}</div>
              </section>
            ))}
            {!groups.length && view === "mine" ? <EmptyState icon="compass" title={t("ui_community_none_yet")} action={t("ui_community_show_others", { n: notMine })} onAction={() => setShow("new")} /> : null}
            {!groups.length && view === "new" ? <EmptyState icon="check" title={t("ui_community_no_new")} action={t("ui_cshow_all")} onAction={() => setShow("all")} /> : null}
          </>
        )}
      </div>
      {create ? <CommunityFormModal onClose={() => setCreate(false)} /> : null}
    </main>
  );
}

/** Co-administrators (optional), chosen by the creator among the members: they change the settings, accept requests and
 * name moderators. Applied at once, like the roles in Members. */
function CoAdmins({ community }: { community: Community }) {
  const me = useStore((s) => s.me);
  const [members, setMembers] = useState<CommunityMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.communityMembers(community.id).then(setMembers).catch(() => setMembers([]));
  useEffect(() => { load(); }, [community.id]);
  const people = (members || []).filter((m) => !m.bot && m.id !== me?.id);
  const admins = people.filter((m) => m.role === "admin");
  const others = people.filter((m) => m.role === "member" || m.role === "moderator")
    .sort((x, y) => x.display_name.localeCompare(y.display_name, undefined, { sensitivity: "base" }));
  const setRole = async (m: CommunityMember, role: string) => {
    setBusy(true);
    try {
      await api.setCommunityRole(community.id, m.id, role);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fld coadmins" id="cm-coadmins">
      <span>{t("ui_community_coadmins")}</span>
      {members && !people.length ? <small className="muted">{t("ui_community_coadmins_no_members")}</small> : null}
      {admins.length ? (
        <div className="chips wrapchips">
          {admins.map((m) => (
            <span key={m.id} className="chip on coadmin">
              {m.display_name}
              <button type="button" className="chipx" disabled={busy} aria-label={t("ui_community_coadmin_remove", { name: m.display_name })} onClick={() => setRole(m, "member")}><Icon name="x" size="sm" /></button>
            </span>
          ))}
        </div>
      ) : null}
      {others.length ? (
        <select id="cm-coadmin-add" className="inp" value="" disabled={busy} onChange={(e) => {
          const m = others.find((x) => String(x.id) === e.target.value);
          if (m) setRole(m, "admin");
        }}>
          <option value="">{t("ui_community_coadmin_add")}</option>
          {others.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
      ) : null}
      {people.length ? <small className="muted">{t("ui_community_coadmins_hint")}</small> : null}
    </div>
  );
}

/** Create a community, or change one (owner and admins). */
function CommunityFormModal({ community, onClose, onSaved }: { community?: Community; onClose: () => void; onSaved?: (c: Community) => void }) {
  const me = useStore((s) => s.me);
  const myAge = me?.dob ? Math.floor((Date.now() - new Date(me.dob + "T00:00:00").getTime()) / (365.2425 * 86400e3)) : 30;
  const [form, setForm] = useState({
    title: community?.title || "", description: community?.description || "", rules: community?.rules || "",
    access_mode: (community?.access_mode || "open") as AccessMode, board_mode: (community?.board_mode || "open") as BoardMode,
    // as typed (they can be emptied while editing); an empty maximum is "no upper limit"
    ageLimit: false, min_age: String(Math.max(18, myAge - 5)), max_age: String(myAge + 5),
    questions: [...(community?.join_questions || []), "", "", ""].slice(0, 3),
    retention: community?.retention_days || 30,
    tags: (community?.kind === "custom" ? community.tags : []) || [],
  });
  const [allInterests, setAllInterests] = useState<{ slug: string; name: string }[]>([]);
  const [pickTags, setPickTags] = useState(false);
  // its category (required to create one), or a new one proposed to the administration ("Other" meanwhile)
  const categories = useStore((s) => s.categories);
  const [language, setLanguage] = useState(community?.language || "");  // empty: the zone's language
  const [catKey, setCatKey] = useState(community && community.kind === "custom" ? community.category || "" : "");
  const [proposing, setProposing] = useState(false);
  const [proposal, setProposal] = useState("");
  useEffect(() => { api.interests().then((l) => setAllInterests(l.filter((i) => i.active !== false))).catch(() => undefined); }, []);
  const interest = community?.kind === "interest";
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  // Only the creator changes who the community admits (where and which ages); whoever stops fitting is expelled
  const owner = !!community && !interest && community.role === "owner";
  const [filters, setFilters] = useState<Awaited<ReturnType<typeof api.communityFilters>> | null>(null);
  const [scope, setScope] = useState("province");
  const [expel, setExpel] = useState<{ n: number; names: string[] } | null>(null);
  useEffect(() => {
    if (!owner || !community) return;
    api.communityFilters(community.id).then((f) => {
      setFilters(f);
      setScope(f.scope_kind);
      set({ ageLimit: f.age_limit, min_age: f.min_age != null ? String(f.min_age) : String(Math.max(18, myAge - 5)), max_age: f.age_limit ? (f.max_age != null ? String(f.max_age) : "") : String(myAge + 5) });
    }).catch(() => undefined);
  }, [owner, community?.id]);
  const minAge = Number(form.min_age) || 18;
  const maxAge = form.max_age.trim() ? Number(form.max_age) : null;
  const ageWrong = form.ageLimit && (minAge > myAge || (maxAge != null && (maxAge < myAge || minAge > maxAge)));
  const filterBody = () => ({ scope_kind: scope, age_limit: form.ageLimit, min_age: form.ageLimit ? minAge : null, max_age: form.ageLimit ? maxAge : null });
  const filtersChanged = () => !!filters && (scope !== filters.scope_kind || form.ageLimit !== filters.age_limit
    || (form.ageLimit && (minAge !== (filters.min_age ?? 18) || maxAge !== filters.max_age)));
  async function save(confirmed = false) {
    setBusy(true);
    try {
      // a change of who it admits that leaves people out: say who first
      if (owner && community && filtersChanged() && !confirmed) {
        const dry = await api.setCommunityFilters(community.id, { ...filterBody(), dry_run: true });
        if (dry.expelled > 0) {
          setExpel({ n: dry.expelled, names: dry.names || [] });
          return;
        }
      }
      const questions = form.access_mode === "request" ? form.questions.map((q) => q.trim()).filter(Boolean) : [];
      const payload = { title: form.title.trim(), description: form.description.trim() || undefined, access_mode: form.access_mode, board_mode: form.board_mode, join_questions: questions,
        ...(interest ? {} : { retention_days: form.retention, interest_tags: form.tags }),
        ...(interest ? {} : proposing ? { category_proposal: proposal.trim() } : catKey ? { category: catKey } : {}),
        ...(community || language ? { language } : {}) };  // "": its zone's
      if (community) {
        let c: Community & { expelled?: number } = await api.updateCommunity(community.id, { ...payload, rules: form.rules.trim() || null });
        if (owner && filtersChanged()) {
          c = await api.setCommunityFilters(community.id, filterBody());
          if (c.expelled) toast(t("ui_community_filters_expelled_toast", { n: c.expelled }));
        }
        toast(t("ui_saved"));
        onSaved?.(c);
        loadMyCommunities();
        onClose();
      } else {
        const c = await api.createCommunity({ ...payload, ...(form.ageLimit ? { min_age: minAge, max_age: maxAge } : {}) });
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
    <Modal wide title={community ? t("ui_community_settings") : t("ui_community_create")} onClose={onClose} footer={(
      <>
        <button className="btn" onClick={onClose}>{t("ui_cancel")}</button>
        <button className="btn pri" disabled={busy || form.title.trim().length < 3 || ((!community || owner) && ageWrong)
          || (!community && !interest && !(proposing ? proposal.trim().length >= 2 : catKey))} onClick={() => save()}>{community ? t("ui_save") : t("ui_community_create_button")}</button>
      </>
    )}>
      {!community ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("ui_community_create_lead")}</p> : null}
      <div className="cform">
      <section className="csec">
      <h3 className="csec-h"><Icon name="edit" size="sm" />{t("ui_csec_general")}</h3>
      <label className="fld">{t("ui_community_f_title")}<input id="cm-title" className="inp" maxLength={80} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={t("ui_community_title_ph")} /></label>
      {!interest ? (
        <div className="fld"><span>{t("ui_community_category")}</span>
          <select id="cm-category" className="inp" value={proposing ? "__new" : catKey} data-n={categories?.length || 0}
            onChange={(e) => { if (e.target.value === "__new") setProposing(true); else { setProposing(false); setCatKey(e.target.value); } }}>
            <option value="">{t("ui_community_category_choose")}</option>
            {CATEGORY_KEYS.filter((k) => k !== "ui_cat_other" || catKey === "ui_cat_other").map((k) => <option key={k} value={k}>{categoryName(k)}</option>)}
            <option value="__new">{t("ui_community_category_propose")}</option>
          </select>
          {proposing ? (
            <>
              <input id="cm-category-proposal" className="inp" maxLength={60} value={proposal} onChange={(e) => setProposal(e.target.value)} placeholder={t("ui_community_category_proposal_ph")} autoFocus />
              <small className="muted">{t("ui_community_category_proposal_hint")}</small>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="fld"><span>{t("ui_community_language")}</span>
        <select id="cm-language" className="inp" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">{t("ui_community_language_auto")}</option>
          {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        <small className="muted">{t("ui_community_language_hint")}</small>
      </div>
      <label className="fld">{t("ui_description")}<textarea id="cm-desc" className="inp" rows={3} maxLength={1000} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("ui_community_desc_ph")} /></label>
      {community ? <div className="fld">{t("ui_community_f_rules")}<RichEditor id="cm-rules" value={form.rules} onChange={(v) => set({ rules: v })} /></div> : null}
      </section>
      <section className="csec">
      <h3 className="csec-h"><Icon name="lock" size="sm" />{t("ui_csec_access")}</h3>
      <div className="fld"><span>{t("ui_community_f_access")}</span>
        <Seg label={t("ui_community_f_access")} value={form.access_mode} onChange={(access_mode) => set({ access_mode })}
          options={[["open", t("ui_community_access_open")], ["request", t("ui_community_access_request")], ["invite", t("ui_community_access_invite")]]} />
        <small className="muted">{accessHints[form.access_mode]}</small>
      </div>
      {form.access_mode === "request" ? (
        <div className="fld"><span>{t("ui_community_f_questions")}</span>
          {form.questions.map((q, i) => (
            <input key={i} id={`cm-question-${i}`} className="inp" maxLength={200} value={q} placeholder={t("ui_community_question_ph", { n: i + 1 })}
              onChange={(e) => set({ questions: form.questions.map((x, j) => (j === i ? e.target.value : x)) })} />
          ))}
          <small className="muted">{t("ui_community_questions_hint")}</small>
        </div>
      ) : null}
      {owner && filters ? (
        <div className="fld"><span>{t("ui_community_scope")}</span>
          <Seg value={scope} onChange={setScope} label={t("ui_community_scope")} options={filters.options.map((o) => [o.kind, o.label] as [string, string])} />
          <small className="muted">{t("ui_community_scope_hint")}</small>
        </div>
      ) : null}
      {!community || (owner && filters) ? (
        <>
          <label className="tgl" htmlFor="cm-age-limit">
            <span className="grow">{t("ui_community_age_limit")}<small>{t("ui_community_age_limit_hint", { age: myAge })}</small></span>
            <input id="cm-age-limit" type="checkbox" role="switch" checked={form.ageLimit} onChange={(e) => set({ ageLimit: e.target.checked })} />
            <span className="sw" aria-hidden="true" />
          </label>
          {form.ageLimit ? (
            <div className="grid2c">
              <label className="fld">{t("ui_community_min_age")}<input id="cm-min-age" className="inp" type="number" inputMode="numeric" min={18} max={myAge} placeholder="18" value={form.min_age} onChange={(e) => set({ min_age: e.target.value })} /></label>
              <label className="fld">{t("ui_community_max_age")}<input id="cm-max-age" className="inp" type="number" inputMode="numeric" min={myAge} max={120} placeholder={t("ui_age_no_limit")} value={form.max_age} onChange={(e) => set({ max_age: e.target.value })} />
                <small className="muted">{t("ui_age_no_limit_hint")}</small></label>
            </div>
          ) : null}
          {ageWrong ? <small className="err">{t("ui_community_age_must_include", { age: myAge })}</small> : null}
        </>
      ) : community.min_age != null || community.max_age != null ? (
        <div className="note"><Icon name="user" size="sm" />{ageSpanText(community)}</div>
      ) : null}
      {owner ? <small className="muted">{t("ui_community_filters_hint")}</small> : null}
      </section>
      {expel ? (
        <ConfirmModal title={t("ui_community_filters_confirm_title")} danger confirm={t("ui_community_filters_confirm")}
          body={t("ui_community_filters_confirm_body", { n: expel.n, names: expel.names.join(", ") + (expel.n > expel.names.length ? "…" : "") })}
          onClose={() => { setExpel(null); setBusy(false); }} onConfirm={() => { setExpel(null); return save(true); }} />
      ) : null}
      {!interest ? (
        <section className="csec">
          <h3 className="csec-h"><Icon name="star" size="sm" />{t("ui_community_interests")}</h3>
          <div className="chips wrapchips">
            {allInterests.filter((i) => form.tags.includes(i.slug)).map((i) => (
              <span key={i.slug} className="chip on">{i.name}</span>
            ))}
            {!form.tags.length ? <small className="muted">{t("ui_community_interests_none")}</small> : null}
          </div>
          <button type="button" id="cm-tags-edit" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setPickTags(true)}>
            <Icon name="edit" size="sm" />{t("ui_community_interests_choose", { n: form.tags.length })}
          </button>
          <small className="muted">{t("ui_community_interests_hint")}</small>
          {pickTags ? (
            <Modal title={t("ui_community_interests")} onClose={() => setPickTags(false)} footer={
              <button type="button" id="cm-tags-done" className="btn pri" onClick={() => setPickTags(false)}>{t("ui_community_interests_done")}</button>}>
              <small className="muted">{t("ui_community_interests_hint")} ({form.tags.length}/5)</small>
              <div className="chips wrapchips">
                {allInterests.map((i) => {
                  const on = form.tags.includes(i.slug);
                  return <button key={i.slug} type="button" className={"chip" + (on ? " on" : "")} aria-pressed={on} disabled={!on && form.tags.length >= 5}
                    onClick={() => set({ tags: on ? form.tags.filter((x) => x !== i.slug) : [...form.tags, i.slug] })}>{i.name}</button>;
                })}
              </div>
            </Modal>
          ) : null}
        </section>
      ) : null}
      {owner && community ? <section className="csec"><h3 className="csec-h"><Icon name="shield" size="sm" />{t("ui_csec_team")}</h3><CoAdmins community={community} /></section> : null}
      <section className="csec">
      <h3 className="csec-h"><Icon name="chat" size="sm" />{t("ui_csec_chat")}</h3>
      <label className="fld">{t("ui_community_retention")}
        {interest ? <span className="note"><Icon name="clock" size="sm" />{t("ui_community_retention_interest")}</span> : (
          <select id="cm-retention" className="inp" value={form.retention} onChange={(e) => set({ retention: Number(e.target.value) })}>
            {RETENTION_DAYS.map((d) => <option key={d} value={d}>{retentionText(d)}</option>)}
          </select>
        )}
        <small className="muted">{t("ui_community_retention_hint")}</small>
      </label>
      <div className="fld"><span>{t("ui_community_f_board")}</span>
        <Seg label={t("ui_community_f_board")} value={form.board_mode} onChange={(board_mode) => set({ board_mode })}
          options={[["open", t("ui_community_board_open")], ["admins", t("ui_community_board_admins")]]} />
        <small className="muted">{form.board_mode === "open" ? t("ui_community_board_open_hint") : t("ui_community_board_admins_hint")}</small>
      </div>
      </section>
      </div>
    </Modal>
  );
}

// ---------- a community ----------
export function CommunityPage({ id, tab }: { id: number; tab: "board" | "chat" | "agenda" | "members" | "stats" }) {
  const [c, setC] = useState<Community | null>(null);
  const unread = useStore((s) => (c ? s.conversations[c.conversation_id]?.unread_count ?? 0 : 0));
  const [error, setError] = useState<string | null>(null);
  const [leave, setLeave] = useState(false);
  const [settings, setSettings] = useState(false);
  const [rules, setRules] = useState(false);
  const [inviting, setInviting] = useState(false);

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
  const tabs: ["board" | "agenda" | "members" | "stats", string][] = [["board", t("ui_community_tab_board")], ["agenda", t("ui_community_tab_agenda")], ["members", t("ui_community_tab_members")],
    ...(staff ? [["stats", t("ui_community_tab_stats")] as ["stats", string]] : [])];
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
      <div className="chero" style={{ background: communityCover(c.slug, "c" + c.id, 120) }}>
        <HeroArt c={c} />
        <div className="herobar">
          <button className="iconbtn glass" onClick={() => goBack("/communities")} aria-label={t("ui_back")}><Icon name="back" /></button>
          <span className="grow" />
          {manager ? <button className="btn glass sm cinvite" onClick={() => setInviting(true)} title={t("ui_community_invite")}><Icon name="userplus" size="sm" />{t("ui_community_invite")}</button> : null}
          {/* with its name: an icon alone was hard to find */}
          {manager ? <button className="btn glass sm cinvite" onClick={() => setSettings(true)} title={t("ui_community_settings")}><Icon name="sliders" size="sm" />{t("ui_edit")}</button> : null}
          {c.joined ? <button className="iconbtn glass" onClick={() => setLeave(true)} aria-label={t("ui_community_leave")} title={t("ui_community_leave")}><Icon name="door" /></button> : null}
        </div>
      </div>
      <div className="swrap chead2">
        <div className="row chead2-main" style={{ alignItems: "flex-end", gap: 14 }}>
          <CommunityBadge c={c} size={72} />
          <div className="grow" style={{ minWidth: 0, paddingBottom: 4 }}>
            <h1 className="dtitle" style={{ margin: 0 }}>{c.title}</h1>
            <div className="muted cmetaline">
              {t("ui_members_n", { n: c.member_count })}
              {c.online_count ? <> · <span className="odot" />{t("ui_community_online_n", { n: c.online_count })}</> : null}
            </div>
          </div>
          <span className="deskonly">{c.joined ? chatButton : <JoinButton c={c} onChange={setC} big />}</span>
        </div>
        {c.description ? <p className="cdescfull">{c.description}</p> : null}
        <div className="row chead2-tags" style={{ flexWrap: "wrap" }}>
          {c.access_mode !== "open" ? <span className="ktag"><Icon name="lock" size="sm" />{t(ACCESS_KEYS[c.access_mode])}</span> : null}
          {c.board_mode === "admins" ? <span className="ktag"><Icon name="megaphone" size="sm" />{t("ui_community_board_admins")}</span> : null}
          <ScopeTags c={c} />
          {c.retention_days ? <span className="ktag" title={t("ui_community_retention_hint")}><Icon name="clock" size="sm" />{t("ui_community_retention_tag", { time: retentionText(c.retention_days) })}</span> : null}
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
      {tab === "stats" && staff ? <CommunityStatsView c={c} /> : null}

      {leave ? (
        <ConfirmModal title={t("ui_community_leave")} body={c.role === "owner" ? t("ui_community_leave_owner_body") : t("ui_community_leave_body", { name: c.title })}
          confirm={t("ui_community_leave")} danger onConfirm={doLeave} onClose={() => setLeave(false)} />
      ) : null}
      {inviting ? <InviteModal c={c} onClose={() => setInviting(false)} /> : null}
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
          <span className="cbadge sm" style={{ background: communityCover(c.slug, "c" + c.id) }}><Icon name="plus" size="sm" /></span>
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
  const [requests, setRequests] = useState<{ user: UserSummary; created_at: string; answers?: { question: string; answer: string }[] }[]>([]);
  const [inviting, setInviting] = useState(false);
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
              <div key={r.user.id} className="item reqitem">
                <Avatar user={r.user} size={36} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.user.display_name}</div>
                  {(r.answers || []).map((x, i) => <div key={i} className="reqanswer"><small>{x.question}</small><span>{x.answer}</span></div>)}
                </div>
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
          <h3 className="boxtitle">{t("ui_community_invite")}</h3>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("ui_community_invite_lead")}</p>
          <div><button className="btn pri sm" onClick={() => setInviting(true)}><Icon name="userplus" size="sm" />{t("ui_community_invite")}</button></div>
          {inviting ? <InviteModal c={c} onClose={() => setInviting(false)} /> : null}
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


type ScopeOf = { language?: string | null; province?: string | null; age_range?: string | null; min_age?: number | null; max_age?: number | null; age_ranges?: string[] | null };

/** "31_60" → "31-60", "61_plus" → "61+". */
function rangeLabel(r: string): string {
  return r.replace("_plus", "+").replace("_", "-");
}

/** Where and for whom a community is, as tags: the place, and its own age span or its age ranges (one tag each). */
export function ScopeTags({ c }: { c: ScopeOf }) {
  const span = c.min_age != null || c.max_age != null;
  const ranges = span ? [] : (c.age_ranges && c.age_ranges.length ? c.age_ranges : c.age_range ? [c.age_range] : []);
  return (
    <>
      {c.province ? <span className="ktag kscope"><Icon name="place" size="sm" />{c.province}</span> : null}
      {span ? <span className="ktag kage"><Icon name="users" size="sm" />{ageSpanText(c as Community)}</span> : null}
      {ranges.map((r) => <span key={r} className="ktag kage"><Icon name="users" size="sm" />{rangeLabel(r)}</span>)}
      {c.language && c.language !== getLang() ? <span className="ktag kscope" title={t("ui_community_language")}>{c.language.toUpperCase()}</span> : null}
    </>
  );
}

/** "25–40 años", "From 25", "Up to 40". */
function ageSpanText(c: Community): string {
  if (c.min_age != null && c.max_age != null) return t("ui_community_ages_span", { min: c.min_age, max: c.max_age });
  if (c.min_age != null) return t("ui_community_ages_from", { min: c.min_age });
  return t("ui_community_ages_upto", { max: c.max_age ?? 0 });
}

/** For the community's staff: members, how they grow, activity, plans, real attendance and ratings. */
function CommunityStatsView({ c }: { c: Community }) {
  const [s, setS] = useState<CommunityStats | null>(null);
  useEffect(() => { api.communityStats(c.id).then(setS).catch((e) => toast(e.message, "error")); }, [c.id]);
  if (!s) return <div className="swrap"><Skeletons n={1} /></div>;
  const max = Math.max(1, ...s.joined_by_week.map((w) => w.count));
  const tiles: [string, string, string | number, string?][] = [
    ["users", t("ui_stats_members"), s.members, t("ui_stats_new_30d", { n: s.new_30d })],
    ["chat", t("ui_stats_messages"), s.messages_30d, t("ui_stats_active_30d", { n: s.active_30d })],
    ["calendar", t("ui_stats_plans"), s.plans_upcoming, t("ui_stats_plans_90d", { n: s.plans_90d })],
    ["check2", t("ui_stats_attendance"), s.attendance.rate != null ? `${Math.round(s.attendance.rate * 100)}%` : "—", t("ui_stats_attendance_sub", { came: s.attendance.came, marked: s.attendance.marked })],
    ["star", t("ui_stats_rating"), s.rating.average != null ? `${s.rating.average.toLocaleString()}★` : "—", t("ui_post_ratings_n", { n: s.rating.count })],
  ];
  return (
    <div className="swrap stack" style={{ gap: 14 }}>
      <div className="cstatgrid">
        {tiles.map(([icon, label, value, sub]) => (
          <div key={label} className="cstat"><Icon name={icon} size="sm" /><b>{value}</b><span>{label}</span>{sub ? <small>{sub}</small> : null}</div>
        ))}
      </div>
      <section className="box">
        <h3 className="boxtitle">{t("ui_stats_joined_weeks")}</h3>
        <div className="cbars">{s.joined_by_week.map((w) => <span key={w.week} title={`${w.week}: ${w.count}`}><i style={{ height: `${Math.max(w.count ? 8 : 3, (w.count / max) * 100)}%` }} className={w.count ? "" : "zero"} /></span>)}</div>
      </section>
      {s.top_organisers.length ? (
        <section className="box">
          <h3 className="boxtitle">{t("ui_stats_top_organisers")}</h3>
          <div className="plist">{s.top_organisers.map((o) => <div key={o.user.id} className="item"><Avatar user={o.user} size={32} /><span className="grow">{o.user.display_name}</span><b>{o.plans}</b></div>)}</div>
        </section>
      ) : null}
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{t("ui_stats_private")}</p>
    </div>
  );
}

/** How long a community's chat keeps its messages (the choices the server accepts). */
const RETENTION_DAYS = [1, 2, 3, 7, 30, 90, 180, 365];

function retentionText(days: number): string {
  const keys: Record<number, string> = { 1: "ui_retention_1d", 2: "ui_retention_2d", 3: "ui_retention_3d", 7: "ui_retention_1w", 30: "ui_retention_1m", 90: "ui_retention_3m", 180: "ui_retention_6m", 365: "ui_retention_1y" };
  return keys[days] ? t(keys[days]) : t("ui_retention_days", { n: days });
}

/** Inviting: the invitation link (copy it, or make a new one that cancels the old), and people registered in MeetGo
 * chosen from a list (my friends and the people of the community's zone whose age fits): they get the invitation in
 * their requests and accept or decline it. */
function InviteModal({ c, onClose }: { c: Community; onClose: () => void }) {
  const [link, setLink] = useState<string | null>(c.invite_code ? `${window.location.origin}/app/join/${c.invite_code}` : null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<(UserSummary & { friend: boolean; invited: boolean })[] | null>(null);
  const [chosen, setChosen] = useState<UserSummary[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => api.inviteCandidates(c.id, q).then(setFound).catch(() => setFound([])), 200);
    return () => window.clearTimeout(timer);
  }, [c.id, q]);
  async function newLink() {
    try {
      const r = await api.communityInvite(c.id);
      setLink(r.url || `${window.location.origin}/app/join/${r.code}`);
      toast(t("ui_community_invite_new_toast"));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function send() {
    setBusy(true);
    try {
      const r = await api.invitePeople(c.id, chosen.map((u) => u.id));
      toast(t("ui_community_invite_sent", { n: r.invited }));
      onClose();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  const options = (found || []).filter((u) => !chosen.some((x) => x.id === u.id));
  return (
    <Modal title={t("ui_community_invite_title", { community: c.title })} onClose={onClose}
      footer={<button className="btn pri" disabled={busy || !chosen.length} onClick={send}>{t("ui_community_invite_send", { n: chosen.length })}</button>}>
      <section className="stack" style={{ gap: 8 }}>
        <b>{t("ui_community_invite_people")}</b>
        <span className="muted" style={{ fontSize: 13 }}>{t("ui_community_invite_people_hint", { zone: c.province || "" })}</span>
        {chosen.length ? (
          <div className="chips wrapchips">
            {chosen.map((u) => (
              <button key={u.id} type="button" className="chip on" onClick={() => setChosen((l) => l.filter((x) => x.id !== u.id))} aria-label={t("ui_remove") + " " + u.display_name}>
                {u.display_name} <Icon name="x" size="sm" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="invpick">
          <div className="search">
            <Icon name="search" size="sm" />
            <input id="cm-invite-search" className="inp" value={q} placeholder={t("ui_community_invite_search")} autoComplete="off"
              onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
          </div>
          {open ? (
            <div className="invlist" role="listbox">
              {found == null ? <div className="muted invnone">…</div>
                : !options.length ? <div className="muted invnone">{t("ui_community_invite_none")}</div>
                : options.map((u) => (
                  <button key={u.id} type="button" role="option" aria-selected="false" className="invopt" disabled={u.invited}
                    onClick={() => { setChosen((l) => [...l, u]); setQ(""); }}>
                    <Avatar user={u} size={30} />
                    <span className="grow">{u.display_name}</span>
                    {u.invited ? <span className="muted">{t("ui_community_invite_already")}</span> : u.friend ? <span className="ktag">{t("ui_friend")}</span> : null}
                  </button>
                ))}
            </div>
          ) : null}
        </div>
      </section>
      <section className="stack" style={{ gap: 8 }}>
        <b>{t("ui_invite_link")}</b>
        <span className="muted" style={{ fontSize: 13 }}>{t("ui_community_invite_hint")}</span>
        {link ? (
          <div className="copyrow">
            <input id="cm-invite" className="inp" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => toast(t("ui_copied"))).catch(() => undefined)}><Icon name="copy" size="sm" />{t("ui_copy")}</button>
          </div>
        ) : null}
        <div><button className="btn sm" onClick={newLink}><Icon name="repeat" size="sm" />{link ? t("ui_community_invite_new") : t("ui_community_invite_create")}</button></div>
      </section>
    </Modal>
  );
}
