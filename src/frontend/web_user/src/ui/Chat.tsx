import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { t } from "@lang";
import { api, fileUrl } from "../api";
import { sendTyping } from "../realtime";
import { chatPath, communityPath, navigate } from "../router";
import {
  addMessage, getState, loadConversations, loadMessages, patchConversation, refreshConversation, removeConversation,
  removeLocal, setState, toast, updateMessage, useStore,
} from "../store";
import type { Conversation, Member, Message } from "../types";
import { dayKey, dayLabel, fileSize, isOnlyEmoji, timeOf, tokenize, uuid } from "../util";
import { Avatar, ConvIcon, EMOJIS, Icon, Modal, QUICK_REACTIONS, convTitle, useClickOutside } from "./common";

const START_INDEX = 1_000_000;

function isStaff(conv: Conversation | undefined, role?: string) {
  return !!conv && (["owner", "admin", "moderator"].includes(conv.role) || role === "admin");
}

/** A conversation. `embedded`: inside another screen (a community's Chat tab), without the back button. */
export function ChatView({ conversationId, around, embedded }: { conversationId: number; around: number | null; embedded?: boolean }) {
  const conv = useStore((s) => s.conversations[conversationId]);
  const list = useStore((s) => s.messages[conversationId]);
  const me = useStore((s) => s.me);
  const billing = useStore((s) => s.billing);
  const typingMap = useStore((s) => s.typing[conversationId]);
  const readState = useStore((s) => s.readStates[conversationId]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [sheetFor, setSheetFor] = useState<Message | null>(null);
  const [reportFor, setReportFor] = useState<Message | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [flashId, setFlashId] = useState<number | null>(around);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const [lastReadAtOpen, setLastReadAtOpen] = useState<number | null>(null);
  const virtuoso = useRef<VirtuosoHandle>(null);
  // The last message stays fully in view: after sending (the message box shrinks back, the keyboard may move) and
  // whenever the visible area changes (keyboard opening or closing) while I was at the bottom.
  const bottomRef = useRef(true);
  const toBottom = useCallback(() => {
    for (const ms of [0, 80, 250, 500]) window.setTimeout(() => virtuoso.current?.scrollToIndex({ index: "LAST", align: "end" }), ms);
  }, []);
  useEffect(() => {
    const vv = window.visualViewport;
    const onResize = () => { if (bottomRef.current) toBottom(); };
    vv?.addEventListener("resize", onResize);
    window.addEventListener("resize", onResize);
    return () => {
      vv?.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, [toBottom]);
  const firstIdRef = useRef<number | null>(null);
  const readTimer = useRef<number | null>(null);

  // Load the conversation and its latest page (or the page around a searched message).
  useEffect(() => {
    let cancelled = false;
    if (!getState().conversations[conversationId]) {
      refreshConversation(conversationId).then(() => {
        if (!cancelled && !getState().conversations[conversationId]) {
          toast(t("ui_conversation_gone"), "error");
          navigate("/chats", true);
        }
      });
    } else {
      refreshConversation(conversationId);
    }
    (async () => {
      try {
        if (around) {
          const page = await api.messages(conversationId, { around_id: around, limit: 60 });
          setState((s) => ({ messages: { ...s.messages, [conversationId]: { items: page.messages, hasMoreBefore: page.has_more_before, loaded: true, loading: false } } }));
        } else if (!getState().messages[conversationId]?.loaded) {
          await loadMessages(conversationId);
        }
      } catch (e: any) {
        toast(e.message, "error");
      }
    })();
    const c = getState().conversations[conversationId];
    if (c && c.kind !== "channel") {
      api.readState(conversationId).then((rows) => setState((s) => ({ readStates: { ...s.readStates, [conversationId]: Object.fromEntries(rows.map((r) => [r.user_id, r.last_read_message_id])) } }))).catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [conversationId, around]);

  useEffect(() => {
    if (conv && lastReadAtOpen == null) setLastReadAtOpen(conv.last_read_message_id);
  }, [conv, lastReadAtOpen]);

  const items = list?.items || [];

  // Keep the scroll position when older messages are prepended.
  useEffect(() => {
    const firstId = items.find((m) => m.id > 0)?.id ?? null;
    const prev = firstIdRef.current;
    if (prev != null && firstId != null && firstId < prev) {
      const added = items.findIndex((m) => m.id === prev);
      if (added > 0) setFirstItemIndex((f) => f - added);
    }
    firstIdRef.current = firstId;
  }, [items]);

  // Mark as read when the newest message is on screen.
  const lastId = [...items].reverse().find((m) => m.id > 0)?.id || 0;
  useEffect(() => {
    if (!conv || !atBottom || !lastId || lastId <= conv.last_read_message_id || document.visibilityState !== "visible") return;
    if (readTimer.current) window.clearTimeout(readTimer.current);
    readTimer.current = window.setTimeout(() => {
      api.read(conversationId, lastId).catch(() => undefined);
      patchConversation(conversationId, { last_read_message_id: lastId, unread_count: 0, mention_count: 0 });
    }, 400);
  }, [atBottom, lastId, conv?.last_read_message_id, conversationId]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && setAtBottom((b) => b);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (!flashId || !items.length) return;
    const idx = items.findIndex((m) => m.id === flashId);
    if (idx >= 0) {
      window.setTimeout(() => virtuoso.current?.scrollToIndex({ index: idx, align: "center" }), 60);
      window.setTimeout(() => setFlashId(null), 1800);
    }
  }, [flashId, items.length]);

  const staff = isStaff(conv, me?.role);
  const firstUnreadId = useMemo(() => {
    if (lastReadAtOpen == null) return null;
    return items.find((m) => m.id > lastReadAtOpen && m.sender?.id !== me?.id && m.kind !== "system")?.id ?? null;
  }, [items, lastReadAtOpen, me?.id]);
  const initialIndex = useMemo(() => {
    if (around) return Math.max(0, items.findIndex((m) => m.id === around));
    if (firstUnreadId) return Math.max(0, items.findIndex((m) => m.id === firstUnreadId) - 1);
    return items.length - 1;
  }, [list?.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpTo = useCallback((messageId: number) => {
    const idx = getState().messages[conversationId]?.items.findIndex((m) => m.id === messageId) ?? -1;
    if (idx >= 0) {
      virtuoso.current?.scrollToIndex({ index: idx, align: "center", behavior: "smooth" });
      setFlashId(messageId);
    } else {
      navigate(chatPath(conversationId, { around: messageId }), true);
    }
  }, [conversationId]);

  if (!conv) {
    return <main className="chat"><div className="empty" style={{ margin: "auto" }}>{t("ui_loading")}</div></main>;
  }

  const typingNames = Object.entries(typingMap || {}).filter(([uid, v]) => +uid !== me?.id && v.until > Date.now() && !v.thread).map(([, v]) => v.name);
  const othersRead = readState ? Math.max(0, ...Object.values(readState)) : 0;
  const myLastId = [...items].reverse().find((m) => m.sender?.id === me?.id && m.id > 0)?.id;
  const readOnly = billing && billing.required && !billing.active;
  const silencedUntil = conv.silenced_until ? new Date(conv.silenced_until) : null;

  const actions: MessageActions = {
    reply: (m) => setReplyTo(m),
    thread: (m) => navigate(chatPath(conversationId, { thread: m.id })),
    react: (m, emoji) => toggleReaction(m, emoji),
    edit: (m) => setEditing(m.id),
    remove: (m) => removeMessage(m),
    report: (m) => setReportFor(m),
    pin: (m) => api.updateConversation(conversationId, { pinned_message_id: conv.pinned_message_id === m.id ? 0 : m.id }).then(() => refreshConversation(conversationId)).catch((e) => toast(e.message, "error")),
    copy: (m) => navigator.clipboard?.writeText(m.body).then(() => toast(t("ui_copied"))).catch(() => undefined),
    openMenu: (m) => setMenuFor(menuFor === m.id ? null : m.id),
    openSheet: (m) => setSheetFor(m),
    jump: jumpTo,
    retry: (m) => retrySend(m),
    profile: (userId) => navigate(chatPath(conversationId, { panel: "members" }) + `&user=${userId}`),
  };

  return (
    <main className={"chat" + (embedded ? " embedded" : "")} aria-label={convTitle(conv)}>
      <ChatHeader conv={conv} />
      {conv.pinned_message ? (
        <button className="banner" onClick={() => jumpTo(conv.pinned_message!.id)}>
          <Icon name="pin" size="sm" /><b>{t("ui_pinned")}</b>
          <span className="txt">{conv.pinned_message.sender?.display_name}: {conv.pinned_message.body}</span>
        </button>
      ) : null}
      {conv.slow_mode_seconds && !staff ? <div className="banner"><Icon name="info" size="sm" /><span className="txt">{t("ui_slow_mode", { seconds: conv.slow_mode_seconds })}</span></div> : null}

      <div className="msgs">
        {list?.loaded ? (
          items.length ? (
            <Virtuoso
              key={`${conversationId}:${around || 0}`}
              ref={virtuoso}
              style={{ height: "100%" }}
              data={items}
              firstItemIndex={firstItemIndex}
              initialTopMostItemIndex={{ index: Math.max(0, initialIndex), align: around ? "center" : "start" }}
              computeItemKey={(_, m) => m.client_id || m.id}
              startReached={() => list.hasMoreBefore && loadMessages(conversationId, true).catch(() => undefined)}
              followOutput={(bottom) => (bottom ? "smooth" : false)}
              atBottomStateChange={(b) => { bottomRef.current = b; setAtBottom(b); }}
              atBottomThreshold={80}
              increaseViewportBy={{ top: 600, bottom: 300 }}
              components={{ Header: () => (list.hasMoreBefore ? <div className="empty" style={{ padding: 12 }}>{t("ui_loading")}</div> : <ConversationStart conv={conv} />) }}
              itemContent={(index, m) => {
                const i = index - firstItemIndex;
                const prev = i > 0 ? items[i - 1] : undefined;
                return (
                  <MessageItem
                    m={m} prev={prev} conv={conv} meId={me?.id} staff={staff} actions={actions}
                    showNewSep={m.id === firstUnreadId}
                    editing={editing === m.id} onEditDone={() => setEditing(null)}
                    menuOpen={menuFor === m.id} closeMenu={() => setMenuFor(null)}
                    flash={flashId === m.id}
                    readTicks={conv.kind !== "channel" && m.id === myLastId ? (othersRead >= m.id ? "read" : "sent") : null}
                  />
                );
              }}
            />
          ) : <ConversationStart conv={conv} />
        ) : <div className="empty">{t("ui_loading")}</div>}
      </div>
      {!atBottom && items.length ? (
        <button className="jump" onClick={() => virtuoso.current?.scrollToIndex({ index: "LAST", behavior: "smooth" })}>
          <Icon name="down" size="sm" />{conv.unread_count ? t("ui_new_messages_n", { n: conv.unread_count }) : t("ui_go_latest")}
        </button>
      ) : null}
      <div className="typing" aria-live="polite">
        {typingNames.length ? (<><span className="dots"><i /><i /><i /></span>{typingText(typingNames)}</>) : null}
      </div>
      {conv.banned ? (
        <div className="readonly"><Icon name="shield" /><span>{t("err_banned_here")}</span></div>
      ) : readOnly ? (
        <div className="readonly"><Icon name="info" /><span className="grow">{t("ui_read_only")}</span><button className="btn pri sm" onClick={() => setState({ paywall: true })}>{t("ui_subscribe")}</button></div>
      ) : silencedUntil && silencedUntil > new Date() ? (
        <div className="readonly"><Icon name="shield" /><span>{t("ui_silenced_until", { time: timeOf(conv.silenced_until!) })}</span></div>
      ) : (
        <Composer conv={conv} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onSent={toBottom} />
      )}

      {sheetFor ? <ActionSheet m={sheetFor} conv={conv} meId={me?.id} staff={staff} actions={actions} onClose={() => setSheetFor(null)} /> : null}
      {reportFor ? <ReportModal m={reportFor} onClose={() => setReportFor(null)} /> : null}
    </main>
  );
}

function typingText(names: string[]) {
  if (names.length === 1) return t("ui_typing_one", { name: names[0] });
  if (names.length === 2) return t("ui_typing_two", { a: names[0], b: names[1] });
  return t("ui_typing_many", { name: names[0], n: names.length - 1 });
}

function ConversationStart({ conv }: { conv: Conversation }) {
  return (
    <div className="empty" style={{ paddingTop: 40 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}><ConvIcon conv={conv} size={56} /></div>
      <h3>{convTitle(conv)}</h3>
      <p>{conv.kind === "channel" ? t("ui_channel_start", { zone: conv.subtitle || "" }) : conv.kind === "group" ? t("ui_group_start") : t("ui_dm_start", { name: conv.title })}</p>
    </div>
  );
}

async function toggleReaction(m: Message, emoji: string) {
  const mine = m.reactions.find((r) => r.emoji === emoji)?.me;
  try {
    await api.react(m.id, emoji, !mine);
  } catch (e: any) {
    toast(e.message, "error");
  }
}

async function removeMessage(m: Message) {
  try {
    await api.deleteMessage(m.id);
  } catch (e: any) {
    toast(e.message, "error");
  }
}

async function retrySend(m: Message) {
  removeLocal(m.conversation_id, m.client_id || "");
  await sendMessage(m.conversation_id, { body: m.body, client_id: m.client_id || uuid() });
}

/** Optimistic send: the message shows at once and is replaced by the server's copy. */
export async function sendMessage(conversationId: number, payload: { body: string; client_id: string; reply_to_id?: number; thread_root_id?: number; also_in_channel?: boolean; mention_ids?: number[]; attachment_ids?: number[] }, replyPreview?: Message | null) {
  const me = getState().me!;
  const temp: Message = {
    id: -Date.now(), conversation_id: conversationId, client_id: payload.client_id, kind: "text",
    sender: { id: me.id, display_name: me.display_name, avatar_url: me.avatar_url }, body: payload.body,
    created_at: new Date().toISOString(), edited_at: null, deleted: false, moderation_reason: null,
    reply_to: replyPreview ? { id: replyPreview.id, sender_name: replyPreview.sender?.display_name || null, body: replyPreview.body, deleted: false } : null,
    thread_root_id: payload.thread_root_id || null, also_in_channel: !!payload.also_in_channel, thread: null,
    mentions: payload.mention_ids || [], reactions: [], attachments: [], pending: true,
  };
  if (!payload.attachment_ids?.length) addMessage(temp);
  try {
    const saved = await api.send(conversationId, payload);
    addMessage(saved);
  } catch (e: any) {
    updateMessage(conversationId, temp.id, (x) => ({ ...x, pending: false, failed: true }));
    if (e.status !== 402) toast(e.message, "error");
    throw e;
  }
}

function ChatHeader({ conv }: { conv: Conversation }) {
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setMenu(false), menu);
  const muted = conv.notify === "none" || (conv.muted_until && new Date(conv.muted_until) > new Date());

  async function settings(payload: { notify?: string; mute_minutes?: number; pinned?: boolean }) {
    setMenu(false);
    try {
      await api.settings(conv.id, payload);
      await refreshConversation(conv.id);
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  async function leave() {
    setMenu(false);
    try {
      await api.removeMember(conv.id, getState().me!.id);
      removeConversation(conv.id);
      navigate("/chats");
      if (conv.kind !== "dm") loadConversations();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  let sub: React.ReactNode = conv.subtitle;
  if (conv.kind === "dm") sub = conv.other_user?.online ? <span className="on">{t("ui_online")}</span> : t("ui_offline");
  else sub = <>{conv.kind === "channel" ? conv.subtitle + " · " : ""}{t("ui_members_n", { n: conv.member_count })}</>;

  return (
    <header className="chead">
      <button className="iconbtn back" onClick={() => navigate("/chats")} aria-label={t("ui_back")}><Icon name="back" /></button>
      <button className="row" style={{ minWidth: 0, textAlign: "left" }} onClick={() => navigate(conv.kind === "channel" ? communityPath(conv.id) : chatPath(conv.id, { panel: conv.kind === "dm" ? "info" : "members" }))}>
        <ConvIcon conv={conv} size={36} />
        <div style={{ minWidth: 0 }}>
          <div className="ttl">{convTitle(conv)}{muted ? <Icon name="belloff" size="sm" /> : null}</div>
          <div className="sub">{sub}</div>
        </div>
      </button>
      <div className="acts" ref={ref} style={{ position: "relative" }}>
        <button className="iconbtn" title={t("ui_search_in_chat")} aria-label={t("ui_search_in_chat")} onClick={() => setSearch(true)}><Icon name="search" /></button>
        <button className="iconbtn opt" title={t("ui_threads")} aria-label={t("ui_threads")} onClick={() => navigate(chatPath(conv.id, { panel: "info" }))}><Icon name="info" /></button>
        {conv.kind !== "dm" ? <button className="iconbtn" title={t("ui_members")} aria-label={t("ui_members")} onClick={() => navigate(chatPath(conv.id, { panel: "members" }))}><Icon name="users" /></button> : null}
        <button className="iconbtn" title={t("ui_more")} aria-label={t("ui_more")} aria-expanded={menu} onClick={() => setMenu((v) => !v)}><Icon name="more" /></button>
        {menu ? (
          <div className="menu" style={{ right: 0, top: 40 }} role="menu">
            <button onClick={() => settings({ notify: "all" })}><Icon name="bell" size="sm" />{t("ui_notify_all")}{conv.notify === "all" ? " ✓" : ""}</button>
            <button onClick={() => settings({ notify: "mentions" })}><Icon name="at" size="sm" />{t("ui_notify_mentions")}{conv.notify === "mentions" ? " ✓" : ""}</button>
            <button onClick={() => settings({ notify: "none" })}><Icon name="belloff" size="sm" />{t("ui_notify_none")}{conv.notify === "none" ? " ✓" : ""}</button>
            {conv.muted_until && new Date(conv.muted_until) > new Date()
              ? <button onClick={() => settings({ mute_minutes: 0 })}><Icon name="bell" size="sm" />{t("ui_unmute")}</button>
              : <>
                  <button onClick={() => settings({ mute_minutes: 60 })}><Icon name="belloff" size="sm" />{t("ui_mute_1h")}</button>
                  <button onClick={() => settings({ mute_minutes: 60 * 24 * 7 })}><Icon name="belloff" size="sm" />{t("ui_mute_week")}</button>
                </>}
            <button onClick={() => settings({ pinned: !conv.pinned })}><Icon name="pin" size="sm" />{conv.pinned ? t("ui_unpin_chat") : t("ui_pin_chat")}</button>
            <button className="warn" onClick={leave}><Icon name="logout" size="sm" />{conv.kind === "dm" ? t("ui_hide_chat") : conv.kind === "channel" ? t("ui_leave_channel") : t("ui_leave_group")}</button>
          </div>
        ) : null}
      </div>
      {search ? <SearchModal conv={conv} onClose={() => setSearch(false)} /> : null}
    </header>
  );
}

function SearchModal({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Message[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setRes(null);
    const id = window.setTimeout(() => api.search(q.trim(), conv.id).then(setRes).catch(() => setRes([])), 300);
    return () => window.clearTimeout(id);
  }, [q, conv.id]);
  return (
    <Modal title={t("ui_search_in", { name: convTitle(conv) })} onClose={onClose}>
      <div className="search"><Icon name="search" size="sm" /><input id="chat-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui_search_placeholder")} /></div>
      <div className="plist">
        {res?.map((m) => (
          <button key={m.id} className="item" style={{ width: "100%", textAlign: "left" }} onClick={() => { onClose(); navigate(chatPath(conv.id, { around: m.id })); }}>
            <Avatar user={m.sender} size={30} />
            <div style={{ minWidth: 0 }} className="grow">
              <div style={{ fontSize: 12 }} className="muted">{m.sender?.display_name} · {dayLabel(m.created_at)} {timeOf(m.created_at)}</div>
              <div style={{ overflowWrap: "anywhere" }}>{m.body}</div>
            </div>
          </button>
        ))}
        {res && !res.length ? <div className="muted">{t("ui_no_results")}</div> : null}
      </div>
    </Modal>
  );
}

// ---------- messages ----------

export type MessageActions = {
  reply: (m: Message) => void;
  thread: (m: Message) => void;
  react: (m: Message, emoji: string) => void;
  edit: (m: Message) => void;
  remove: (m: Message) => void;
  report: (m: Message) => void;
  pin: (m: Message) => void;
  copy: (m: Message) => void;
  openMenu: (m: Message) => void;
  openSheet: (m: Message) => void;
  jump: (id: number) => void;
  retry: (m: Message) => void;
  profile: (userId: number) => void;
};

const MOD_REASONS: Record<string, string> = {
  FLOOD: "ui_mod_flood", LINKS_NOT_ALLOWED: "ui_mod_links", PHONE_NOT_ALLOWED: "ui_mod_phone", CAPS_SPAM: "ui_mod_caps",
  TOXICITY: "ui_mod_toxic", REMOVED_BY_MODERATOR: "ui_mod_removed",
};

export function MessageItem(props: {
  m: Message; prev?: Message; conv: Conversation; meId?: number; staff: boolean; actions: MessageActions; inThread?: boolean;
  showNewSep?: boolean; editing?: boolean; onEditDone?: () => void; menuOpen?: boolean; closeMenu?: () => void; flash?: boolean;
  readTicks?: "read" | "sent" | null;
}) {
  const { m, prev, conv, meId, staff, actions, inThread } = props;
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => props.closeMenu?.(), !!props.menuOpen);
  const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
  const cont = !newDay && !props.showNewSep && prev && prev.kind !== "system" && m.kind !== "system" && prev.sender?.id === m.sender?.id
    && !m.reply_to && !prev.thread && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60000;
  const mine = m.sender?.id === meId;
  const blocked = useStore((s) => s.blocked);
  const mentioned = meId != null && m.mentions.includes(meId);
  const canEdit = mine && !m.deleted && Date.now() - new Date(m.created_at).getTime() < 48 * 3600000;

  const separators = (
    <>
      {newDay ? <div className="daysep">{dayLabel(m.created_at)}</div> : null}
      {props.showNewSep ? <div className="newsep">{t("ui_new_messages")}</div> : null}
    </>
  );

  if (m.kind === "system") {
    return <div>{separators}<div className="sysmsg"><span>{m.body}</span></div></div>;
  }
  if (!mine && m.sender && blocked.includes(m.sender.id)) {
    return <div>{separators}<div className="sysmsg blockedmsg"><span>{t("ui_blocked_message")}</span></div></div>;
  }

  const onTouchStart = () => {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      actions.openSheet(m);
    }, 450);
  };
  const cancelPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
  };
  // After a long press, lifting the finger must not "click" the sheet that just opened under it (it would close it).
  const onTouchEnd = (e: React.TouchEvent) => {
    cancelPress();
    if (longPressed.current) e.preventDefault();
  };

  return (
    <div>
      {separators}
      <div
        className={["msg", mine ? "mine" : "", cont ? "cont" : "", mentioned ? "mention" : "", props.flash ? "flash" : "", m.pending ? "pending" : "", m.failed ? "failed" : ""].join(" ")}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchMove={cancelPress}
        onContextMenu={(e) => { if (window.matchMedia("(pointer: coarse)").matches) { e.preventDefault(); actions.openSheet(m); } }}
      >
        <div className="avcol"><button onClick={() => m.sender && actions.profile(m.sender.id)} aria-label={m.sender?.display_name}><Avatar user={m.sender} size={inThread ? 32 : 38} /></button></div>
        <div className="mbody">
          {!cont ? (
            <div className="mh">
              <button className="who" onClick={() => m.sender && actions.profile(m.sender.id)}>{mine ? t("ui_you") : m.sender?.display_name || t("ui_deleted_user")}</button>
              <span className="when" title={new Date(m.created_at).toLocaleString()}>{timeOf(m.created_at)}</span>
              {m.thread_root_id && m.also_in_channel && !inThread ? <span className="when">· {t("ui_replied_in_thread")}</span> : null}
            </div>
          ) : null}
          {m.reply_to ? (
            <button className="quote" onClick={() => actions.jump(m.reply_to!.id)}>
              <b>{m.reply_to.sender_name || ""}</b> · {m.reply_to.deleted ? t("ui_msg_deleted") : m.reply_to.body}
            </button>
          ) : null}
          {props.editing ? <EditBox m={m} onDone={props.onEditDone!} /> : m.deleted ? (
            <div className="mt del modnote"><Icon name="shield" size="sm" />{m.moderation_reason ? t(MOD_REASONS[m.moderation_reason] || "ui_mod_generic") : t("ui_msg_deleted")}</div>
          ) : (
            <div className={"mt" + (isOnlyEmoji(m.body) && !m.attachments.length ? " big" : "")}>
              {m.body ? <Rich text={m.body} /> : null}
              {m.edited_at ? <span className="edited"> ({t("ui_edited")})</span> : null}
              {props.readTicks ? <span className="ticks" title={props.readTicks === "read" ? t("ui_read") : t("ui_sent")}> <Icon name={props.readTicks === "read" ? "check2" : "check"} size="sm" /></span> : null}
            </div>
          )}
          {m.attachments.length ? <Attachments m={m} /> : null}
          {m.failed ? <button className="linkbtn" style={{ fontSize: 12 }} onClick={() => actions.retry(m)}>{t("ui_retry")}</button> : null}
          {m.reactions.length ? (
            <div className="reacts">
              {m.reactions.map((r) => (
                <button key={r.emoji} className={"react" + (r.me ? " me" : "")} onClick={() => actions.react(m, r.emoji)} aria-pressed={!!r.me}>{r.emoji} {r.count}</button>
              ))}
            </div>
          ) : null}
          {m.thread && !inThread ? (
            <button className="tsum" onClick={() => actions.thread(m)}>
              <span className="mini">{m.thread.participants.map((p) => <Avatar key={p.id} user={p} size={20} />)}</span>
              {t("ui_replies_n", { n: m.thread.count })}
              {m.thread.last_reply_at ? <span className="lt">· {t("ui_last_at", { time: timeOf(m.thread.last_reply_at) })}</span> : null}
            </button>
          ) : null}
        </div>
        {!m.deleted && !m.pending && !m.failed ? (
          <div className="mtools" role="toolbar" aria-label={t("ui_message_actions")}>
            {QUICK_REACTIONS.slice(0, 3).map((e) => <button key={e} onClick={() => actions.react(m, e)} title={t("ui_react")}>{e}</button>)}
            <button onClick={() => actions.reply(m)} title={t("ui_reply")}><Icon name="reply" size="sm" /></button>
            {!inThread && conv.kind !== "dm" ? <button onClick={() => actions.thread(m)} title={t("ui_reply_thread")}><Icon name="thread" size="sm" /></button> : null}
            <button onClick={() => actions.openMenu(m)} title={t("ui_more")} aria-expanded={props.menuOpen}><Icon name="more" size="sm" /></button>
          </div>
        ) : null}
        {props.menuOpen ? (
          <div className="menu" style={{ right: 18, top: 16 }} ref={menuRef} role="menu">
            <div className="row" style={{ padding: "2px 4px 6px", gap: 2 }}>
              {QUICK_REACTIONS.map((e) => <button key={e} style={{ width: 30, justifyContent: "center", fontSize: 17, padding: 4 }} onClick={() => { actions.react(m, e); props.closeMenu?.(); }}>{e}</button>)}
            </div>
            <MenuActions m={m} conv={conv} mine={mine} canEdit={canEdit} staff={staff} actions={actions} inThread={inThread} done={() => props.closeMenu?.()} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MenuActions({ m, conv, mine, canEdit, staff, actions, inThread, done }: { m: Message; conv: Conversation; mine: boolean; canEdit: boolean; staff: boolean; actions: MessageActions; inThread?: boolean; done: () => void }) {
  const run = (fn: () => void) => () => { done(); fn(); };
  return (
    <>
      <button onClick={run(() => actions.reply(m))}><Icon name="reply" size="sm" />{t("ui_reply")}</button>
      {!inThread && conv.kind !== "dm" ? <button onClick={run(() => actions.thread(m))}><Icon name="thread" size="sm" />{t("ui_reply_thread")}</button> : null}
      {m.body ? <button onClick={run(() => actions.copy(m))}><Icon name="copy" size="sm" />{t("ui_copy")}</button> : null}
      {canEdit && m.body ? <button onClick={run(() => actions.edit(m))}><Icon name="edit" size="sm" />{t("ui_edit")}</button> : null}
      {staff && conv.kind !== "dm" && !inThread ? <button onClick={run(() => actions.pin(m))}><Icon name="pin" size="sm" />{conv.pinned_message_id === m.id ? t("ui_unpin") : t("ui_pin")}</button> : null}
      {!mine ? <button onClick={run(() => actions.report(m))}><Icon name="flag" size="sm" />{t("ui_report")}</button> : null}
      {mine || staff ? <button className="warn" onClick={run(() => actions.remove(m))}><Icon name="trash" size="sm" />{t("ui_delete")}</button> : null}
    </>
  );
}

export function ActionSheet({ m, conv, meId, staff, actions, onClose, inThread }: { m: Message; conv: Conversation; meId?: number; staff: boolean; actions: MessageActions; onClose: () => void; inThread?: boolean }) {
  const mine = m.sender?.id === meId;
  const canEdit = mine && !m.deleted && Date.now() - new Date(m.created_at).getTime() < 48 * 3600000;
  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="menu">
        <div className="grab" />
        <div className="rbar">{QUICK_REACTIONS.map((e) => <button key={e} onClick={() => { actions.react(m, e); onClose(); }}>{e}</button>)}</div>
        <div className="menu" style={{ position: "static", boxShadow: "none", border: 0, background: "transparent" }}>
          <MenuActions m={m} conv={conv} mine={mine} canEdit={canEdit} staff={staff} actions={actions} inThread={inThread} done={onClose} />
        </div>
      </div>
    </div>
  );
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {tokenize(text).map((tok, i) =>
        tok.kind === "link" ? <a key={i} href={tok.value} target="_blank" rel="noopener noreferrer nofollow">{tok.value}</a>
          : tok.kind === "mention" ? <span key={i} className="at">{tok.value}</span>
          : <React.Fragment key={i}>{tok.value}</React.Fragment>,
      )}
    </>
  );
}

function Attachments({ m }: { m: Message }) {
  return (
    <div className="atts">
      {m.attachments.map((a) => a.mime.startsWith("image/") ? (
        <a key={a.id} className="att-img" href={fileUrl(a.url)} target="_blank" rel="noopener noreferrer">
          <img src={fileUrl(a.thumb_url || a.url)} alt={a.file_name} loading="lazy" width={a.width ? Math.min(a.width, 360) : undefined} />
        </a>
      ) : (
        <a key={a.id} className="att-file" href={fileUrl(a.url)} target="_blank" rel="noopener noreferrer" download={a.file_name}>
          <Icon name="file" />
          <span style={{ minWidth: 0 }}><span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.file_name}</span><small>{fileSize(a.size)}</small></span>
        </a>
      ))}
    </div>
  );
}

function EditBox({ m, onDone }: { m: Message; onDone: () => void }) {
  const [body, setBody] = useState(m.body);
  async function save() {
    if (body.trim() && body.trim() !== m.body) {
      try {
        await api.editMessage(m.id, body.trim());
      } catch (e: any) {
        toast(e.message, "error");
        return;
      }
    }
    onDone();
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <textarea
        className="inp" value={body} autoFocus rows={Math.min(6, body.split("\n").length + 1)} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
          if (e.key === "Escape") onDone();
        }}
      />
      <div className="row"><button className="btn pri sm" onClick={save}>{t("ui_save")}</button><button className="btn sm" onClick={onDone}>{t("ui_cancel")}</button><span className="muted" style={{ fontSize: 12 }}>{t("ui_edit_hint")}</span></div>
    </div>
  );
}

function ReportModal({ m, onClose }: { m: Message; onClose: () => void }) {
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  async function send() {
    try {
      await api.report(m.id, reason, details.trim() || undefined);
      toast(t("ui_reported"));
      onClose();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  return (
    <Modal title={t("ui_report_title")} onClose={onClose} footer={<button className="btn pri" onClick={send}>{t("ui_report")}</button>}>
      <div className="quote" style={{ whiteSpace: "normal" }}><b>{m.sender?.display_name}</b> · {m.body}</div>
      <label className="fld">{t("ui_reason")}
        <select id="report-reason" className="inp" value={reason} onChange={(e) => setReason(e.target.value)}>
          {["spam", "harassment", "hate", "sexual", "violence", "other"].map((r) => <option key={r} value={r}>{t("ui_reason_" + r)}</option>)}
        </select>
      </label>
      <label className="fld">{t("ui_details_optional")}<textarea id="report-details" className="inp" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
    </Modal>
  );
}

// ---------- composer ----------

type PendingAttachment = { id?: number; name: string; preview?: string; uploading: boolean };

export function Composer({ conv, replyTo, onCancelReply, threadRootId, onSent, compact }: {
  conv: Conversation; replyTo?: Message | null; onCancelReply?: () => void; threadRootId?: number; onSent?: () => void; compact?: boolean;
}) {
  const draftKey = `draft:${conv.id}:${threadRootId || 0}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(draftKey) || "";
    } catch {
      return "";
    }
  });
  const [mentionIds, setMentionIds] = useState<Record<string, number>>({});
  const [members, setMembers] = useState<Member[] | null>(null);
  const [suggest, setSuggest] = useState<{ q: string; start: number; index: number } | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [atts, setAtts] = useState<PendingAttachment[]>([]);
  const [alsoInChannel, setAlsoInChannel] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  useClickOutside(emojiRef, () => setEmojiOpen(false), emojiOpen);

  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {
      /* drafts are a convenience */
    }
  }, [text, draftKey]);

  useEffect(() => {
    if (replyTo) area.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [text]);

  const candidates = useMemo(() => {
    if (!suggest || !members) return [];
    const q = suggest.q.toLowerCase();
    return members.filter((m) => m.id !== getState().me?.id && m.display_name.toLowerCase().includes(q)).slice(0, 8);
  }, [suggest, members]);

  function onChange(value: string, caret: number) {
    setText(value);
    sendTyping(conv.id, threadRootId || null);
    const upto = value.slice(0, caret);
    const match = conv.kind !== "dm" ? upto.match(/(^|\s)@([\p{L}\p{N}_.-]{0,30})$/u) : null;
    if (match) {
      if (!members) api.members(conv.id).then(setMembers).catch(() => setMembers([]));
      setSuggest({ q: match[2], start: caret - match[2].length - 1, index: 0 });
    } else {
      setSuggest(null);
    }
  }

  function pickMention(m: Member) {
    if (!suggest) return;
    const caret = area.current?.selectionStart ?? text.length;
    const name = m.display_name.replace(/\s+/g, "_");
    const next = text.slice(0, suggest.start) + "@" + name + " " + text.slice(caret);
    setText(next);
    setMentionIds((ids) => ({ ...ids, [name]: m.id }));
    setSuggest(null);
    window.setTimeout(() => area.current?.focus(), 0);
  }

  async function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files).slice(0, 10)) {
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      const entry: PendingAttachment = { name: file.name || "imagen.png", preview, uploading: true };
      setAtts((a) => [...a, entry]);
      try {
        const res = await api.upload(file, entry.name);
        setAtts((a) => a.map((x) => (x === entry ? { ...x, id: res.id, uploading: false } : x)));
      } catch (e: any) {
        toast(e.message, "error");
        setAtts((a) => a.filter((x) => x !== entry));
      }
    }
  }

  async function submit() {
    const body = text.trim();
    const ready = atts.filter((a) => a.id && !a.uploading).map((a) => a.id!);
    if ((!body && !ready.length) || atts.some((a) => a.uploading)) return;
    const mention_ids = Object.entries(mentionIds).filter(([name]) => body.includes("@" + name)).map(([, id]) => id);
    const payload = {
      body, client_id: uuid(), reply_to_id: replyTo?.id, thread_root_id: threadRootId,
      also_in_channel: threadRootId ? alsoInChannel : undefined, mention_ids, attachment_ids: ready,
    };
    setText("");
    setAtts([]);
    setMentionIds({});
    onCancelReply?.();
    onSent?.();
    try {
      await sendMessage(conv.id, payload, replyTo);
    } catch {
      if (!body) setAtts(atts);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggest && candidates.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSuggest({ ...suggest, index: (suggest.index + 1) % candidates.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSuggest({ ...suggest, index: (suggest.index - 1 + candidates.length) % candidates.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(candidates[suggest.index]); return; }
      if (e.key === "Escape") { setSuggest(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !window.matchMedia("(pointer: coarse)").matches) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape" && replyTo) onCancelReply?.();
  }

  const placeholder = threadRootId ? t("ui_reply_in_thread_ph") : conv.kind === "channel" ? t("ui_message_in", { name: convTitle(conv) }) : t("ui_message_to", { name: conv.title });

  return (
    <div className={"composer" + (compact ? " compact" : "")}>
      {suggest && candidates.length ? (
        <div className="suggest" role="listbox">
          {candidates.map((m, i) => (
            <button key={m.id} className={i === suggest.index ? "on" : ""} role="option" aria-selected={i === suggest.index} onMouseDown={(e) => { e.preventDefault(); pickMention(m); }}>
              <Avatar user={m} size={24} online={m.online} />{m.display_name}
            </button>
          ))}
        </div>
      ) : null}
      {emojiOpen ? (
        <div className="emojis" ref={emojiRef}>
          {EMOJIS.map((e) => <button key={e} onClick={() => { setText((v) => v + e); setEmojiOpen(false); area.current?.focus(); }}>{e}</button>)}
        </div>
      ) : null}
      {replyTo ? (
        <div className="rprev"><Icon name="reply" size="sm" /><span>{t("ui_replying_to")} <b>{replyTo.sender?.display_name}</b> · {replyTo.body}</span><button className="iconbtn" onClick={onCancelReply} aria-label={t("ui_cancel")}><Icon name="x" size="sm" /></button></div>
      ) : null}
      {atts.length ? (
        <div className="pending-atts">
          {atts.map((a, i) => (
            <div key={i} className="patt">
              {a.preview ? <img src={a.preview} alt="" /> : <Icon name="file" size="sm" />}
              <span>{a.uploading ? t("ui_uploading") : a.name}</span>
              <button className="iconbtn" style={{ width: 22, height: 22 }} onClick={() => setAtts((x) => x.filter((y) => y !== a))} aria-label={t("ui_remove")}><Icon name="x" size="sm" /></button>
            </div>
          ))}
        </div>
      ) : null}
      <textarea
        id={`composer-${conv.id}-${threadRootId || 0}`}
        ref={area} rows={1} value={text} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)} onKeyDown={onKeyDown}
        onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
      />
      <div className="ctools">
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <button className="iconbtn" title={t("ui_attach")} aria-label={t("ui_attach")} onClick={() => fileInput.current?.click()}><Icon name="attach" /></button>
        <button className="iconbtn" title={t("ui_emoji")} aria-label={t("ui_emoji")} onClick={() => setEmojiOpen((v) => !v)}><Icon name="smile" /></button>
        {threadRootId && conv.kind !== "dm" ? (
          <label className="check" style={{ fontSize: 11.5, marginLeft: 6 }}><input type="checkbox" checked={alsoInChannel} onChange={(e) => setAlsoInChannel(e.target.checked)} />{t("ui_also_send_to", { name: convTitle(conv) })}</label>
        ) : null}
        <span className="hint">{compact ? "" : t("ui_enter_hint")}</span>
        {/* keeps the focus (and the phone's keyboard) in the text after sending, as chat apps do */}
        <button className="sendb" onMouseDown={(e) => e.preventDefault()} onClick={submit} title={t("ui_send")} aria-label={t("ui_send")} disabled={atts.some((a) => a.uploading)}><Icon name="send" size="sm" /></button>
      </div>
    </div>
  );
}
