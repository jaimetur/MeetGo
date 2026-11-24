import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@lang";
import { api } from "../api";
import { chatPath, navigate } from "../router";
import { loadConversations, sortedConversations, toast, useStore } from "../store";
import type { Conversation, Message, UserSummary } from "../types";
import { shortWhen } from "../util";
import { PhoneTop } from "./Board";
import { ConvMenuItems } from "./Chat";
import { Avatar, ConvIcon, Icon, Modal, convTitle } from "./common";

type Filter = "all" | "unread" | "mentions" | "channel" | "plan" | "group" | "dm";

export function Sidebar({ activeId }: { activeId: number | null }) {
  const conversations = useStore((s) => s.conversations);
  const all = useMemo(() => sortedConversations(conversations), [conversations]);
  const typing = useStore((s) => s.typing);
  const meId = useStore((s) => s.me?.id);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Message[] | null>(null);
  const [newChat, setNewChat] = useState(false);
  // Plan chats are groups: the ones of my plans are listed apart.
  const myPlans = useStore((s) => s.myPlans);
  const planChats = useMemo(() => new Set((myPlans || []).map((p) => p.chat_conversation_id).filter((x): x is number => !!x)), [myPlans]);
  const kindOf = (c: Conversation): Filter => (c.kind === "group" && planChats.has(c.id) ? "plan" : c.kind);

  useEffect(() => {
    setFound(null);
    if (q.trim().length < 3) return;
    const id = window.setTimeout(() => api.search(q.trim()).then(setFound).catch(() => setFound([])), 350);
    return () => window.clearTimeout(id);
  }, [q]);

  const visible = all.filter((c) => {
    if (q && !convTitle(c).toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "unread") return c.unread_count > 0;
    if (filter === "mentions") return c.mention_count > 0;
    if (filter !== "all") return kindOf(c) === filter;
    return true;
  });
  const sections: [string, Conversation[]][] = [
    [t("ui_sec_pinned"), visible.filter((c) => c.pinned)],
    [t("ui_sec_communities"), visible.filter((c) => !c.pinned && c.kind === "channel")],
    [t("ui_sec_plans"), visible.filter((c) => !c.pinned && kindOf(c) === "plan")],
    [t("ui_sec_groups"), visible.filter((c) => !c.pinned && kindOf(c) === "group")],
    [t("ui_sec_direct"), visible.filter((c) => !c.pinned && c.kind === "dm")],
  ];
  const filters: [Filter, string][] = [
    ["all", t("ui_f_all")], ["unread", t("ui_f_unread")], ["mentions", t("ui_f_mentions")],
    ["channel", t("ui_f_communities")], ["plan", t("ui_f_plans")], ["group", t("ui_f_groups")], ["dm", t("ui_f_direct")],
  ];

  return (
    <aside className="list" aria-label={t("ui_nav_chats")}>
      <PhoneTop title={t("ui_nav_chats")} />
      <div className="lhead">
        <div className="row titlerow">
          <div className="ltitle grow">{t("ui_nav_chats")}</div>
          <button className="iconbtn compose" title={t("ui_new_chat")} aria-label={t("ui_new_chat")} onClick={() => setNewChat(true)}><Icon name="edit" /></button>
        </div>
        <div className="search">
          <Icon name="search" size="sm" />
          <input id="conv-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_search_placeholder")} aria-label={t("ui_search_placeholder")} />
          {q ? <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => setQ("")} aria-label={t("ui_clear")}><Icon name="x" size="sm" /></button> : null}
        </div>
        <div className="chips" role="tablist">
          {filters.map(([f, label]) => (
            <button key={f} role="tab" aria-selected={filter === f} className={"chip" + (filter === f ? " on" : "")} onClick={() => setFilter(f)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="lbody">
        {sections.map(([label, items]) => items.length ? (
          <div key={label}>
            <div className="lsec">{label}</div>
            {items.map((c) => <ConvRow key={c.id} c={c} active={c.id === activeId} typing={Object.entries(typing[c.id] || {}).some(([uid, v]) => +uid !== meId && v.until > Date.now() && !v.thread)} />)}
          </div>
        ) : null)}
        {!visible.length && !found?.length ? (
          <div className="empty">
            {all.length ? t("ui_no_results") : (
              <>
                <h3>{t("ui_empty_title")}</h3>
                <p>{t("ui_chats_empty_body")}</p>
                <button className="btn pri" onClick={() => navigate("/communities")}>{t("ui_board_find_communities")}</button>
              </>
            )}
          </div>
        ) : null}
        {found ? (
          <div>
            <div className="lsec">{t("ui_sec_messages")}</div>
            {found.length ? found.slice(0, 20).map((m) => <FoundRow key={m.id} m={m} />) : <div className="empty">{t("ui_no_results")}</div>}
          </div>
        ) : null}
      </div>
      {newChat ? <NewChatModal onClose={() => setNewChat(false)} /> : null}
    </aside>
  );
}

function ConvRow({ c, active, typing }: { c: Conversation; active: boolean; typing: boolean }) {
  const muted = c.notify === "none" || (c.muted_until && new Date(c.muted_until) > new Date());
  const last = c.last_message;
  let preview = "";
  if (last) {
    const who = last.kind === "system" ? "" : last.sender_name && c.kind !== "dm" ? `${last.sender_name}: ` : "";
    preview = last.deleted ? t("ui_msg_deleted") : who + (last.body || (last.has_attachments ? "📎 " + t("ui_attachment") : ""));
  }
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
    <button className={"crow" + (c.unread_count ? " unr" : "") + (active ? " sel" : "") + (menuAt ? " ctx" : "")} onClick={() => navigate(chatPath(c.id))} aria-current={active ? "page" : undefined}
      onContextMenu={(e) => { e.preventDefault(); setMenuAt({ x: e.clientX, y: e.clientY }); }}>
      <ConvIcon conv={c} />
      <div style={{ minWidth: 0 }}>
        <div className="cname">{convTitle(c)}{muted ? <Icon name="belloff" size="sm" /> : null}{c.pinned ? <Icon name="pin" size="sm" /> : null}</div>
        <div className="cprev">{typing ? <span className="typ">{t("ui_typing_short")}</span> : preview || <span>{c.kind === "channel" ? "" : c.subtitle || ""}</span>}</div>
      </div>
      <div className="cmeta">
        {shortWhen(last?.created_at || c.last_message_at)}
        <div className="bd">
          {c.mention_count ? <span className="bdg at">@</span> : null}
          {c.unread_count ? <span className={"bdg" + (muted ? " mute" : "")}>{c.unread_count > 99 ? "99+" : c.unread_count}</span> : null}
        </div>
      </div>
    </button>
    {menuAt ? <ContextMenu at={menuAt} onClose={() => setMenuAt(null)}><ConvMenuItems conv={c} onDone={() => setMenuAt(null)} /></ContextMenu> : null}
    </>
  );
}

/** A menu where the pointer is (kept inside the window); closes on a click elsewhere, Escape or scrolling. */
function ContextMenu({ at, onClose, children }: { at: { x: number; y: number }; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(at.y, window.innerHeight - h - 8)) });
  }, [at]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="menu ctxmenu" role="menu" style={{ position: "fixed", left: pos.left, top: pos.top }}>{children}</div>,
    document.body,
  );
}

function FoundRow({ m }: { m: Message }) {
  const conv = useStore((s) => s.conversations[m.conversation_id]);
  return (
    <button className="crow" onClick={() => navigate(chatPath(m.conversation_id, { around: m.id }))}>
      <Avatar user={m.sender} size={34} />
      <div style={{ minWidth: 0 }}>
        <div className="cname">{m.sender?.display_name} · <span className="muted">{conv ? convTitle(conv) : ""}</span></div>
        <div className="cprev">{m.body}</div>
      </div>
      <div className="cmeta">{shortWhen(m.created_at)}</div>
    </button>
  );
}

export function NewChatModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"dm" | "group">("dm");
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<any[]>([]);
  const [friends, setFriends] = useState<(UserSummary & { online: boolean })[] | null>(null);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<number[]>([]);

  useEffect(() => {
    api.friends().then(setFriends).catch(() => setFriends([]));
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) return setPeople([]);
    const id = window.setTimeout(() => api.searchUsers(q).then(setPeople).catch(() => setPeople([])), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  const searching = q.trim().length >= 2;
  const candidates = useMemo(() => (searching ? people : (friends || []).map((f) => ({ ...f, friend: true, accept_dm: true }))), [searching, people, friends]);

  async function openDm(id: number) {
    setBusy(true);
    try {
      const res = await api.openDm(id);
      if (res.conversation_id) {
        await loadConversations();
        navigate(chatPath(res.conversation_id));
        onClose();
      } else {
        setAsked((a) => [...a, id]);
        toast(t("ui_dm_request_sent"));
      }
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function createGroup() {
    setBusy(true);
    try {
      const res = await api.createGroup(title.trim(), picked);
      await loadConversations();
      navigate(chatPath(res.id));
      onClose();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const chosen = (friends || []).filter((f) => picked.includes(f.id));

  return (
    <Modal title={t("ui_new_chat")} onClose={onClose} footer={tab === "group" ? (
      <button className="btn pri block" disabled={busy || !title.trim()} onClick={createGroup}>
        <Icon name="users" size="sm" />{picked.length ? t("ui_nc_create_n", { n: picked.length + 1 }) : t("ui_create_group")}
      </button>
    ) : undefined}>
      <div className="ncmode" role="tablist">
        <button role="tab" aria-selected={tab === "dm"} className={tab === "dm" ? "on" : ""} onClick={() => setTab("dm")}>
          <span className="ncico"><Icon name="user" /></span>
          <span className="nctx"><b>{t("ui_direct_message")}</b><small>{t("ui_nc_dm_hint")}</small></span>
        </button>
        <button role="tab" aria-selected={tab === "group"} className={tab === "group" ? "on" : ""} onClick={() => setTab("group")}>
          <span className="ncico"><Icon name="users" /></span>
          <span className="nctx"><b>{t("ui_new_group")}</b><small>{t("ui_nc_group_hint")}</small></span>
        </button>
      </div>

      {tab === "dm" ? (
        <>
          <div className="search"><Icon name="search" size="sm" /><input id="dm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_search_people")} />
            {q ? <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => setQ("")} aria-label={t("ui_clear")}><Icon name="x" size="sm" /></button> : null}
          </div>
          <div className="ncsec">{searching ? t("ui_nc_results") : t("ui_nc_friends")}</div>
          <div className="nclist">
            {candidates.map((p) => {
              const can = p.friend || p.accept_dm;
              const done = asked.includes(p.id) || p.dm_requested;
              return (
                <button key={p.id} className="ncrow" disabled={busy || !can || done} onClick={() => openDm(p.id)}>
                  <Avatar user={p} size={40} online={p.online} />
                  <span className="nctx grow">
                    <b>{p.display_name}</b>
                    <small>{p.friend ? t("ui_friend") : p.accept_dm ? t("ui_needs_request") : t("ui_no_dms")}</small>
                  </span>
                  {done ? <span className="ncact wait">{t("ui_nc_asked")}</span>
                    : !can ? <span className="ncact off"><Icon name="lock" size="sm" /></span>
                    : p.friend ? <span className="ncact go"><Icon name="chat" size="sm" />{t("ui_write")}</span>
                    : <span className="ncact">{t("ui_ask_dm")}</span>}
                </button>
              );
            })}
            {friends === null && !searching ? <div className="ncempty muted">…</div> : null}
            {friends !== null && !candidates.length ? (
              <div className="ncempty">
                <Icon name={searching ? "search" : "users"} />
                <div className="muted">{searching ? t("ui_no_results") : t("ui_nc_no_friends")}</div>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <label className="fld"><span className="ncsec">{t("ui_nc_step_name")}</span>
            <input id="group-title" className="inp" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("ui_group_name_ph")} />
          </label>
          <div className="ncsec">{t("ui_nc_step_people")}</div>
          {chosen.length ? (
            <div className="ncchosen">
              {chosen.map((f) => (
                <button key={f.id} className="ncchip" onClick={() => toggle(f.id)} aria-label={t("ui_nc_remove", { name: f.display_name })}>
                  <Avatar user={f} size={22} /><span>{f.display_name}</span><Icon name="x" size="sm" />
                </button>
              ))}
            </div>
          ) : null}
          <div className="nclist">
            {(friends || []).map((f) => {
              const on = picked.includes(f.id);
              return (
                <button key={f.id} className={"ncrow" + (on ? " picked" : "")} aria-pressed={on} onClick={() => toggle(f.id)}>
                  <Avatar user={f} size={40} online={f.online} />
                  <span className="nctx grow"><b>{f.display_name}</b><small>{t("ui_friend")}</small></span>
                  <span className={"nccheck" + (on ? " on" : "")}>{on ? <Icon name="check" size="sm" /> : null}</span>
                </button>
              );
            })}
            {friends !== null && !friends.length ? (
              <div className="ncempty"><Icon name="users" /><div className="muted">{t("ui_no_friends_yet")}</div></div>
            ) : null}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_group_members_hint")}</div>
        </>
      )}
    </Modal>
  );
}
