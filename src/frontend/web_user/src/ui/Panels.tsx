import React, { useEffect, useMemo, useState } from "react";
import { t } from "@lang";
import { api } from "../api";
import { chatPath, navigate, queryParam } from "../router";
import { getState, loadBlocks, loadConversations, loadThread, refreshConversation, toast, useStore } from "../store";
import type { Conversation, Member, Message } from "../types";
import { ActionSheet, Composer, MessageItem, type MessageActions } from "./Chat";
import { Avatar, Icon, convTitle, shownName } from "./common";
import { RichEditor, RichText } from "./RichText";
import { ScopeTags } from "./Communities";
import { useSwipeDown } from "./swipeClose";

export function SidePanel({ conversationId, thread, panel }: { conversationId: number; thread: number | null; panel: "members" | "info" | null }) {
  const conv = useStore((s) => s.conversations[conversationId]);
  if (!conv) return null;
  const close = () => navigate(chatPath(conversationId));
  const tab = thread ? "thread" : panel;
  // on phones it covers the chat: a swipe down closes it, as the sheets (unless a list inside is scrolled down)
  const swipe = useSwipeDown(close, ".sbody, .msgs, [data-virtuoso-scroller], .plist, textarea");
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  return (
    <aside className="side" aria-label={t("ui_side_panel")} {...(coarse ? swipe.handlers : {})} style={swipe.style}>
      <div className="stabs">
        {thread ? <button className="stab on">{t("ui_thread")}</button> : null}
        {conv.kind !== "dm" ? <button className={"stab" + (tab === "members" ? " on" : "")} onClick={() => navigate(chatPath(conversationId, { panel: "members" }))}>{t("ui_members")}</button> : null}
        <button className={"stab" + (tab === "info" ? " on" : "")} onClick={() => navigate(chatPath(conversationId, { panel: "info" }))}>{t("ui_info")}</button>
        <span className="grow" />
        <button className="iconbtn" onClick={close} aria-label={t("ui_close")}><Icon name="x" /></button>
      </div>
      {tab === "thread" && thread ? <ThreadPanel conv={conv} rootId={thread} /> : null}
      {tab === "members" ? <MembersPanel conv={conv} /> : null}
      {tab === "info" ? <InfoPanel conv={conv} /> : null}
    </aside>
  );
}

function ThreadPanel({ conv, rootId }: { conv: Conversation; rootId: number }) {
  const th = useStore((s) => s.threads[rootId]);
  const me = useStore((s) => s.me);
  const typingMap = useStore((s) => s.typing[conv.id]);
  const billing = useStore((s) => s.billing);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [sheetFor, setSheetFor] = useState<Message | null>(null);
  useEffect(() => {
    loadThread(rootId, conv.id).catch((e) => toast(e.message, "error"));
  }, [rootId, conv.id]);
  const staff = ["owner", "admin", "moderator"].includes(conv.role) || me?.role === "admin";
  const actions: MessageActions = {
    reply: setReplyTo,
    thread: () => undefined,
    react: (m, e) => api.react(m.id, e, !m.reactions.find((r) => r.emoji === e)?.me).catch((err) => toast(err.message, "error")),
    edit: () => toast(t("ui_edit_in_chat")),
    remove: (m) => api.deleteMessage(m.id).catch((e) => toast(e.message, "error")),
    report: () => toast(t("ui_report_in_chat")),
    pin: () => undefined,
    copy: (m) => navigator.clipboard?.writeText(m.body).catch(() => undefined),
    openMenu: () => undefined,
    openSheet: setSheetFor,
    jump: () => undefined,
    retry: () => undefined,
    profile: (id) => navigate(chatPath(conv.id, { panel: "members" }) + `&user=${id}`),
  };
  const typing = Object.entries(typingMap || {}).filter(([uid, v]) => +uid !== me?.id && v.until > Date.now() && v.thread === rootId).map(([, v]) => v.name);
  const readOnly = (billing && billing.required && !billing.active) || conv.banned;
  if (!th?.loaded) return <div className="empty">{t("ui_loading")}</div>;
  return (
    <>
      <div className="sbody">
        {th.root ? <div className="troot"><MessageItem m={{ ...th.root, thread: null }} conv={conv} meId={me?.id} staff={staff} actions={actions} inThread /></div> : null}
        <div className="tcount">{t("ui_replies_n", { n: th.items.length })}</div>
        {th.items.map((m, i) => <MessageItem key={m.client_id || m.id} m={m} prev={i ? th.items[i - 1] : th.root ? { ...th.root, thread: null } : undefined} conv={conv} meId={me?.id} staff={staff} actions={actions} inThread />)}
      </div>
      <div className="typing">{typing.length ? <><span className="dots"><i /><i /><i /></span>{t("ui_typing_one", { name: typing[0] })}</> : null}</div>
      {readOnly ? null : <Composer conv={conv} threadRootId={rootId} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} compact />}
      {sheetFor ? <ActionSheet m={sheetFor} conv={conv} meId={me?.id} staff={staff} actions={actions} onClose={() => setSheetFor(null)} inThread /> : null}
    </>
  );
}

function MembersPanel({ conv }: { conv: Conversation }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(queryParam("user") ? Number(queryParam("user")) : null);
  useEffect(() => {
    let alive = true;
    const load = () => api.members(conv.id).then((m) => alive && setMembers(m)).catch(() => undefined);
    load();
    const id = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [conv.id]);
  useEffect(() => {
    const u = queryParam("user");
    if (u) setSelected(Number(u));
  }, [conv.id]);
  const filtered = useMemo(() => (members || []).filter((m) => m.display_name.toLowerCase().includes(q.toLowerCase())), [members, q]);
  const staff = filtered.filter((m) => m.role !== "member");
  const online = filtered.filter((m) => m.role === "member" && m.online);
  const offline = filtered.filter((m) => m.role === "member" && !m.online);
  const row = (m: Member) => (
    <button key={m.id} className={"mrow" + (m.online ? "" : " off")} onClick={() => setSelected(m.id)}>
      <Avatar user={m} size={30} online={m.online} />
      <span className="nm">{m.display_name}</span>
      {m.role !== "member" ? <span className="role">{t("ui_role_" + m.role)}</span> : null}
    </button>
  );
  return (
    <div className="sbody">
      {selected ? <ProfileCard conv={conv} userId={selected} member={members?.find((m) => m.id === selected)} onClose={() => setSelected(null)} onChanged={() => api.members(conv.id).then(setMembers)} /> : null}
      <div className="search" style={{ margin: "12px 12px 4px" }}><Icon name="search" size="sm" /><input id="member-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_search_members")} /></div>
      {!members ? <div className="empty">{t("ui_loading")}</div> : null}
      {staff.length ? <><div className="lsec">{t("ui_staff_n", { n: staff.length })}</div>{staff.map(row)}</> : null}
      {online.length ? <><div className="lsec">{t("ui_online_n", { n: online.length })}</div>{online.map(row)}</> : null}
      {offline.length ? <><div className="lsec">{t("ui_offline_n", { n: offline.length })}</div>{offline.map(row)}</> : null}
    </div>
  );
}

function ProfileCard({ conv, userId, member, onClose, onChanged }: { conv: Conversation; userId: number; member?: Member; onClose?: () => void; onChanged: () => void }) {
  const me = useStore((s) => s.me);
  const [user, setUser] = useState<any>(null);
  const [following, setFollowing] = useState<number[]>([]);
  useEffect(() => {
    api.user(userId).then(setUser).catch(() => setUser({ id: userId, display_name: member?.display_name || "—", hidden: true }));
    api.following().then(setFollowing).catch(() => undefined);
  }, [userId]);
  // every hook before the early return: React needs the same hooks on every render (it used to freeze the app here)
  const blocked = useStore((s) => s.blocked);
  if (!user) return null;
  const isMe = me?.id === userId;
  const staff = ["owner", "admin", "moderator"].includes(conv.role) || me?.role === "admin";
  const canModerate = staff && !isMe && member && member.role !== "owner" && conv.kind !== "dm";

  async function run(fn: () => Promise<unknown>, done?: string): Promise<boolean> {
    try {
      await fn();
      if (done) toast(done);
      onChanged();
      return true;
    } catch (e: any) {
      toast(e.message, "error");
      return false;
    }
  }
  // Communities: take someone out (they may join again) or expel them (they cannot come back).
  function kick(ban: boolean) {
    const ask = `${t(ban ? "ui_community_ban_member" : "ui_community_remove_member")}: ${user.display_name}\n${t(ban ? "ui_community_ban_hint" : "ui_community_remove_hint")}`;
    if (!window.confirm(ask)) return;
    void run(() => api.removeCommunityMember(conv.id, userId, ban), t(ban ? "ui_community_member_banned" : "ui_community_member_removed", { name: user.display_name })).then(() => onClose?.());
  }
  function banFor(hours: number | null) {
    if (hours === null) return kick(true);
    if (!window.confirm(t("ui_ban_confirm_hours", { name: user.display_name, hours }))) return;
    void run(() => api.banCommunityMember(conv.id, userId, hours), t("ui_banned_toast", { name: user.display_name })).then(() => onClose?.());
  }
  async function message() {
    try {
      const res = await api.openDm(userId);
      if (res.conversation_id) {
        await loadConversations();
        navigate(chatPath(res.conversation_id));
      } else toast(t("ui_dm_request_sent"));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  return (
    <div className="card">
      <div className="row">
        <Avatar user={user} size={48} online={user.online} />
        <div style={{ minWidth: 0 }} className="grow">
          <div className="nm">{user.first_name ? shownName(user) : user.display_name}</div>
          <div className="meta">{[user.province, user.online ? t("ui_online") : t("ui_offline"), member && member.role !== "member" ? t("ui_role_" + member.role) : null].filter(Boolean).join(" · ")}</div>
        </div>
        {onClose ? <button className="iconbtn" onClick={onClose} aria-label={t("ui_close")}><Icon name="x" size="sm" /></button> : null}
      </div>
      {user.bio ? <div style={{ fontSize: 13 }}>{user.bio}</div> : null}
      {!isMe ? (
        <div className="btns">
          {/* in our direct chat already: no "send a message" */}
          {!(conv.kind === "dm" && conv.other_user?.id === userId) ? <button className="btn pri sm" onClick={message}>{t("ui_send_message")}</button> : null}
          {user.friend ? <button className="btn sm" disabled>{t("ui_friend")} ✓</button>
            : user.friend_requested ? <button className="btn sm" disabled>{t("ui_friend_request_pending")} ✓</button>
            : <button className="btn sm" onClick={() => run(() => api.friendRequest(userId), t("ui_friend_request_sent")).then((ok) => ok && setUser((u: any) => ({ ...u, friend_requested: true })))}>{t("ui_add_friend")}</button>}
          {following.includes(userId)
            ? <button className="btn sm" onClick={() => run(() => api.unfollow(userId)).then(() => setFollowing((f) => f.filter((x) => x !== userId)))}>{t("ui_unfollow")}</button>
            : <button className="btn sm" onClick={() => run(() => api.follow(userId)).then(() => setFollowing((f) => [...f, userId]))}>{t("ui_follow")}</button>}
          {blocked.includes(userId)
            ? <button className="btn sm" onClick={() => run(() => api.unblock(userId), t("ui_unblocked_toast", { name: user.display_name })).then(loadBlocks)}>{t("ui_unblock")}</button>
            : <button className="btn sm danger" onClick={() => {
              if (window.confirm(t("ui_block_confirm", { name: user.display_name }))) run(() => api.block(userId), t("ui_blocked_toast", { name: user.display_name })).then(loadBlocks);
            }}><Icon name="lock" size="sm" />{t("ui_block")}</button>}
        </div>
      ) : null}
      {canModerate ? (
        <>
          <div className="lsec" style={{ padding: "4px 0 0" }}>{t("ui_moderation")}</div>
          <div className="btns">
            {member?.silenced_until
              ? <button className="btn sm" onClick={() => run(() => api.moderate(conv.id, userId, "unsilence"), t("ui_done"))}>{t("ui_unsilence")}</button>
              : <button className="btn sm" onClick={() => run(() => api.moderate(conv.id, userId, "silence", 60), t("ui_done"))}>{t("ui_silence_1h")}</button>}
            {conv.kind === "channel" ? (
              <>
                <button className="btn sm" onClick={() => banFor(6)}>{t("ui_ban_6h")}</button>
                <button className="btn sm" onClick={() => banFor(24)}>{t("ui_ban_24h")}</button>
                <button className="btn sm danger" onClick={() => banFor(null)}><Icon name="shield" size="sm" />{t("ui_ban_forever")}</button>
                <button className="btn sm" onClick={() => kick(false)}><Icon name="door" size="sm" />{t("ui_community_remove_member")}</button>
              </>
            ) : (
              <button className="btn sm danger" onClick={() => run(() => api.moderate(conv.id, userId, conv.kind === "group" ? "remove" : "ban"), t("ui_done"))}>{conv.kind === "group" ? t("ui_remove_member") : t("ui_ban")}</button>
            )}
            {conv.kind === "group" && conv.role === "owner" ? (
              member?.role === "admin"
                ? <button className="btn sm" onClick={() => run(() => api.setRole(conv.id, userId, "member"), t("ui_done"))}>{t("ui_make_member")}</button>
                : <button className="btn sm" onClick={() => run(() => api.setRole(conv.id, userId, "admin"), t("ui_done"))}>{t("ui_make_admin")}</button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function InfoPanel({ conv }: { conv: Conversation }) {
  const me = useStore((s) => s.me);
  const staff = ["owner", "admin", "moderator"].includes(conv.role) || me?.role === "admin";
  const [title, setTitle] = useState(conv.title);
  const [description, setDescription] = useState(conv.description || "");
  const [slow, setSlow] = useState(conv.slow_mode_seconds);
  const [rules, setRules] = useState(conv.rules_markdown || "");
  const [friends, setFriends] = useState<{ id: number; display_name: string; avatar_url?: string | null }[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    setRules(conv.rules_markdown || "");
  }, [conv.rules_markdown]);
  const inviteLink = conv.invite_code ? `${window.location.origin}/app/join/${conv.invite_code}` : "";

  async function save() {
    try {
      await api.updateConversation(conv.id, conv.kind === "group" ? { title, description, slow_mode_seconds: slow, rules_markdown: rules } : { slow_mode_seconds: slow, rules_markdown: rules });
      await refreshConversation(conv.id);
      toast(t("ui_saved"));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  return (
    <div className="sbody infopanel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div className="info-title">{convTitle(conv)}</div>
        <div className="muted info-meta">{conv.kind !== "dm" ? t("ui_members_n", { n: conv.member_count }) : ""}</div>
        {conv.kind === "channel" ? <div className="row info-tags"><ScopeTags c={conv} /></div> : null}
        {conv.description && !(staff && conv.kind === "group") ? <p style={{ fontSize: 13 }}>{conv.description}</p> : null}
      </div>
      {conv.rules_markdown && !staff ? (
        <div className="rulescard"><div className="rulescard-head"><Icon name="shield" />{t("ui_rules")}</div><RichText text={conv.rules_markdown} /></div>
      ) : null}
      {conv.kind === "group" && staff ? (
        <div className="stack">
          <label className="fld">{t("ui_group_name")}<input id="info-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="fld">{t("ui_description")}<textarea id="info-desc" className="inp" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        </div>
      ) : null}
      {staff && conv.kind !== "dm" ? (
        <div className="stack">
          <label className="fld">{t("ui_slow_mode_label")}
            <select id="info-slow" className="inp" value={slow} onChange={(e) => setSlow(Number(e.target.value))}>
              {[0, 5, 10, 30, 60, 300].map((s) => <option key={s} value={s}>{s ? t("ui_seconds_n", { n: s }) : t("ui_off")}</option>)}
            </select>
          </label>
          <div className="fld">{t("ui_rules")}<RichEditor id="info-rules" value={rules} onChange={setRules} /></div>
          <button className="btn pri" onClick={save}>{t("ui_save")}</button>
        </div>
      ) : null}
      {conv.kind === "group" && staff ? (
        <div className="stack">
          <div className="lsec" style={{ padding: 0 }}>{t("ui_invite_link")}</div>
          <div className="row"><input id="info-invite" className="inp" readOnly value={inviteLink} onFocus={(e) => e.target.select()} /></div>
          <div className="row">
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(inviteLink).then(() => toast(t("ui_copied"))).catch(() => undefined)}>{t("ui_copy")}</button>
            <button className="btn sm" onClick={() => api.newInvite(conv.id).then(() => refreshConversation(conv.id)).catch((e) => toast(e.message, "error"))}>{t("ui_new_link")}</button>
            <button className="btn sm" onClick={() => { setAddOpen((v) => !v); api.friends().then(setFriends).catch(() => undefined); }}>{t("ui_add_friends")}</button>
          </div>
          {addOpen ? (
            <div className="plist">
              {friends.map((f) => (
                <div key={f.id} className="item"><Avatar user={f} size={28} /><span className="grow">{f.display_name}</span>
                  <button className="btn sm" onClick={() => api.addMembers(conv.id, [f.id]).then(() => toast(t("ui_added"))).catch((e) => toast(e.message, "error"))}>{t("ui_add")}</button>
                </div>
              ))}
              {!friends.length ? <div className="muted">{t("ui_no_friends_yet")}</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {conv.kind === "dm" && conv.other_user ? <ProfileCard conv={conv} userId={conv.other_user.id} onChanged={() => undefined} /> : null}
      <div className="muted" style={{ fontSize: 12 }}>{t("ui_notify_current", { mode: t("ui_notify_" + conv.notify) })}</div>
    </div>
  );
}

export function ensureThreadVisible(m: Message) {
  if (!getState().threads[m.id]) loadThread(m.id, m.conversation_id).catch(() => undefined);
}
