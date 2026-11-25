// Communities of my zone: the list, creating one, and a community's page (board, chat and members).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@lang";
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
              <span>{wide ? `${c.province} · ` : ""}{t("ui_members_n", { n: c.member_count })}</span>
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
  ["ui_cat_social", /tomar|caf[eé]|cerve|beer|copa|drink|picnic|network|gastro|comida|cena|food|tapas|fiesta|party|amig|friend/],
  ["ui_cat_sports", /deport|sport|balonc|basket|futbol|fútbol|football|soccer|tenis|tennis|padel|pádel|fitness|crossfit|gym|cicl|bici|bike|mtb|run|correr|nata|swim|surf|yoga/],
  ["ui_cat_nature", /sender|hik|trek|monta|mountain|playa|beach|viaj|travel|natur|camp/],
  ["ui_cat_culture", /cine|film|movie|lect|libro|book|read|m[uú]sic|music|concier|concert|rock|flamenc|arte|art|foto|photo|teatro|theat/],
  ["ui_cat_education", /aprend|idioma|ingl[eé]s|alem[aá]n|franc[eé]s|learn|language|educa|curso|course/],
  ["ui_cat_skills", /cocina|cook|guitar|bater[ií]a|drum|teclado|keyboard|piano|baile|danc/],
  ["ui_cat_motor", /coche|car\b|auto|moto/],
];

/** The category keys, in the order the lists show them. */
export const CATEGORY_KEYS = [...CATEGORIES.map(([k]) => k), "ui_cat_other"];

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
  // All of them, only mine (Open, blue) or only new ones (Join, green); remembered on this device.
  type Show = "all" | "mine" | "new";
  const [show, setShowState] = useState<Show>(() => {
    try {
      const v = localStorage.getItem("communities.show");
      if (v === "all" || v === "mine" || v === "new") return v;
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
  const mineCount = (list || []).length - notMine;
  const shown = (list || []).filter((c) => browse || show === "all" || (show === "mine" ? c.joined : !c.joined));
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
          <div className="segtabs cfilter" role="tablist" aria-label={t("ui_nav_communities")}>
            {([["all", t("ui_cshow_all"), t("ui_cshow_all"), list.length], ["mine", t("ui_cshow_mine"), t("ui_cshow_mine_short"), mineCount],
              ["new", t("ui_cshow_new"), t("ui_cshow_new"), notMine]] as [Show, string, string, number][]).map(([k, label, short, n]) => (
              <button key={k} id={`communities-show-${k}`} role="tab" aria-selected={show === k} aria-label={`${label} ${n}`} className={show === k ? "on" : ""} onClick={() => setShow(k)}>
                <span className="cfl">{label}</span><span className="cfs">{short}</span> <span className="cfn">{n}</span>
              </button>
            ))}
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
                <div className="lsec ccat-title">{t(cat)} <span className="muted">· {items.length}</span></div>
                <div className="cgrid">{items.map((c) => <CommunityCard key={c.id} c={c} onChange={update} />)}</div>
              </section>
            ))}
            {!groups.length && show === "mine" ? <EmptyState icon="compass" title={t("ui_community_none_yet")} action={t("ui_community_show_others", { n: notMine })} onAction={() => setShow("new")} /> : null}
            {!groups.length && show === "new" ? <EmptyState icon="check" title={t("ui_community_no_new")} action={t("ui_cshow_all")} onAction={() => setShow("all")} /> : null}
          </>
        )}
      </div>
      {create ? <CommunityFormModal onClose={() => setCreate(false)} /> : null}
    </main>
  );
}

/** Create a community, or change one (owner and admins). */
function CommunityFormModal({ community, onClose, onSaved }: { community?: Community; onClose: () => void; onSaved?: (c: Community) => void }) {
  const me = useStore((s) => s.me);
  const myAge = me?.dob ? Math.floor((Date.now() - new Date(me.dob + "T00:00:00").getTime()) / (365.2425 * 86400e3)) : 30;
  const [form, setForm] = useState({
    title: community?.title || "", description: community?.description || "", rules: community?.rules || "",
    access_mode: (community?.access_mode || "open") as AccessMode, board_mode: (community?.board_mode || "open") as BoardMode,
    ageLimit: false, min_age: Math.max(18, myAge - 5), max_age: myAge + 5,
    questions: [...(community?.join_questions || []), "", "", ""].slice(0, 3),
    retention: community?.retention_days || 30,
  });
  const interest = community?.kind === "interest";
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  async function save() {
    setBusy(true);
    try {
      const questions = form.access_mode === "request" ? form.questions.map((q) => q.trim()).filter(Boolean) : [];
      const payload = { title: form.title.trim(), description: form.description.trim() || undefined, access_mode: form.access_mode, board_mode: form.board_mode, join_questions: questions,
        ...(interest ? {} : { retention_days: form.retention }) };
      if (community) {
        const c = await api.updateCommunity(community.id, { ...payload, rules: form.rules.trim() || null });
        toast(t("ui_saved"));
        onSaved?.(c);
        loadMyCommunities();
        onClose();
      } else {
        const c = await api.createCommunity({ ...payload, ...(form.ageLimit ? { min_age: form.min_age, max_age: form.max_age } : {}) });
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
        <button className="btn pri" disabled={busy || form.title.trim().length < 3 || (!community && form.ageLimit && (form.min_age > myAge || form.max_age < myAge || form.min_age > form.max_age))} onClick={save}>{community ? t("ui_save") : t("ui_community_create_button")}</button>
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
      {form.access_mode === "request" ? (
        <div className="fld"><span>{t("ui_community_f_questions")}</span>
          {form.questions.map((q, i) => (
            <input key={i} id={`cm-question-${i}`} className="inp" maxLength={200} value={q} placeholder={t("ui_community_question_ph", { n: i + 1 })}
              onChange={(e) => set({ questions: form.questions.map((x, j) => (j === i ? e.target.value : x)) })} />
          ))}
          <small className="muted">{t("ui_community_questions_hint")}</small>
        </div>
      ) : null}
      {!community ? (
        <>
          <label className="tgl" htmlFor="cm-age-limit">
            <span className="grow">{t("ui_community_age_limit")}<small>{t("ui_community_age_limit_hint", { age: myAge })}</small></span>
            <input id="cm-age-limit" type="checkbox" role="switch" checked={form.ageLimit} onChange={(e) => set({ ageLimit: e.target.checked })} />
            <span className="sw" aria-hidden="true" />
          </label>
          {form.ageLimit ? (
            <div className="grid2c">
              <label className="fld">{t("ui_community_min_age")}<input id="cm-min-age" className="inp" type="number" min={18} max={myAge} value={form.min_age} onChange={(e) => set({ min_age: Number(e.target.value) || 18 })} /></label>
              <label className="fld">{t("ui_community_max_age")}<input id="cm-max-age" className="inp" type="number" min={myAge} max={120} value={form.max_age} onChange={(e) => set({ max_age: Number(e.target.value) || myAge })} /></label>
            </div>
          ) : null}
          {form.ageLimit && (form.min_age > myAge || form.max_age < myAge) ? <small className="err">{t("ui_community_age_must_include", { age: myAge })}</small> : null}
        </>
      ) : community.min_age != null || community.max_age != null ? (
        <div className="note"><Icon name="user" size="sm" />{ageSpanText(community)}</div>
      ) : null}
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
          {c.min_age != null || c.max_age != null ? <span className="ktag"><Icon name="user" size="sm" />{ageSpanText(c)}</span> : null}
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
      <div className="cstats">
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
