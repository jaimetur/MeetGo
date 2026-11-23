import React, { useEffect, useMemo, useState } from "react";
import { t } from "@lang";
import { api } from "../api";
import { chatPath, navigate } from "../router";
import { loadConversations, sortedConversations, toast, useStore } from "../store";
import type { Conversation, Message, UserSummary } from "../types";
import { shortWhen } from "../util";
import { Avatar, ConvIcon, Icon, Modal, Wordmark, convTitle } from "./common";

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
  const zone = all.find((c) => c.kind === "channel")?.subtitle;
  const sections: [string, Conversation[]][] = [
    [t("ui_sec_pinned"), visible.filter((c) => c.pinned)],
    [zone ? t("ui_sec_communities_zone", { zone }) : t("ui_sec_communities"), visible.filter((c) => !c.pinned && c.kind === "channel")],
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
      <div className="lhead">
        <div className="brandbar">
          <img className="appicon" src="/apple-touch-icon.png" alt="" />
          <Wordmark size={26} />
          <span className="grow" />
          <button className="iconbtn compose" title={t("ui_new_chat")} aria-label={t("ui_new_chat")} onClick={() => setNewChat(true)}><Icon name="edit" /></button>
        </div>
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
  return (
    <button className={"crow" + (c.unread_count ? " unr" : "") + (active ? " sel" : "")} onClick={() => navigate(chatPath(c.id))} aria-current={active ? "page" : undefined}>
      <ConvIcon conv={c} />
      <div style={{ minWidth: 0 }}>
        <div className="cname">{convTitle(c)}{muted ? <Icon name="belloff" size="sm" /> : null}{c.pinned ? <Icon name="pin" size="sm" /> : null}</div>
        <div className="cprev">{typing ? <span className="typ">{t("ui_typing_short")}</span> : preview || <span>{c.subtitle || ""}</span>}</div>
      </div>
      <div className="cmeta">
        {shortWhen(last?.created_at || c.last_message_at)}
        <div className="bd">
          {c.mention_count ? <span className="bdg at">@</span> : null}
          {c.unread_count ? <span className={"bdg" + (muted ? " mute" : "")}>{c.unread_count > 99 ? "99+" : c.unread_count}</span> : null}
        </div>
      </div>
    </button>
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
  const [friends, setFriends] = useState<(UserSummary & { online: boolean })[]>([]);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.friends().then(setFriends).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) return setPeople([]);
    const id = window.setTimeout(() => api.searchUsers(q).then(setPeople).catch(() => setPeople([])), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  const candidates = useMemo(() => (q.trim().length >= 2 ? people : friends.map((f) => ({ ...f, friend: true, accept_dm: true }))), [q, people, friends]);

  async function openDm(id: number) {
    setBusy(true);
    try {
      const res = await api.openDm(id);
      if (res.conversation_id) {
        await loadConversations();
        navigate(chatPath(res.conversation_id));
        onClose();
      } else {
        toast(t("ui_dm_request_sent"));
        onClose();
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

  return (
    <Modal title={t("ui_new_chat")} onClose={onClose} footer={tab === "group" ? (
      <button className="btn pri" disabled={busy || !title.trim()} onClick={createGroup}>{t("ui_create_group")}</button>
    ) : undefined}>
      <div className="tabs">
        <button className={"chip" + (tab === "dm" ? " on" : "")} onClick={() => setTab("dm")}>{t("ui_direct_message")}</button>
        <button className={"chip" + (tab === "group" ? " on" : "")} onClick={() => setTab("group")}>{t("ui_new_group")}</button>
      </div>
      {tab === "group" ? (
        <>
          <label className="fld">{t("ui_group_name")}<input id="group-title" className="inp" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("ui_group_name_ph")} /></label>
          <div className="muted" style={{ fontSize: 12.5 }}>{t("ui_group_members_hint")}</div>
          <div className="plist">
            {friends.length ? friends.map((f) => (
              <label key={f.id} className="item check">
                <input type="checkbox" checked={picked.includes(f.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f.id] : p.filter((x) => x !== f.id)))} />
                <Avatar user={f} size={30} online={f.online} />
                <span className="grow">{f.display_name}</span>
              </label>
            )) : <div className="muted">{t("ui_no_friends_yet")}</div>}
          </div>
        </>
      ) : (
        <>
          <div className="search"><Icon name="search" size="sm" /><input id="dm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_search_people")} /></div>
          <div className="plist">
            {candidates.map((p) => (
              <div key={p.id} className="item">
                <Avatar user={p} size={34} online={p.online} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div>{p.display_name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{p.friend ? t("ui_friend") : p.accept_dm ? t("ui_needs_request") : t("ui_no_dms")}</div>
                </div>
                <button className="btn sm" disabled={busy || (!p.friend && !p.accept_dm)} onClick={() => openDm(p.id)}>{p.friend ? t("ui_write") : t("ui_request")}</button>
              </div>
            ))}
            {!candidates.length ? <div className="muted">{q.trim().length >= 2 ? t("ui_no_results") : t("ui_search_people_hint")}</div> : null}
          </div>
        </>
      )}
    </Modal>
  );
}
