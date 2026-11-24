import { api, WS_BASE } from "./api";
import { emitBoardEvent } from "./board";
import {
  addMessage, catchUp, getState, loadConversations, loadMessages, patchConversation, refreshConversation, removeConversation,
  refreshMyPlansSoon, replaceMessage, setReactions, setState, updateMessage,
} from "./store";
import type { Message } from "./types";

let ws: WebSocket | null = null;
let retry = 0;
let timer: number | null = null;
let stopped = true;
const lastTyping: Record<string, number> = {};
let onRemoved: ((conversationId: number) => void) | null = null;
let onRequests: (() => void) | null = null;
let onIncoming: ((m: Message) => void) | null = null;

export function setRealtimeHooks(h: { removed?: (id: number) => void; requests?: () => void; incoming?: (m: Message) => void }) {
  onRemoved = h.removed || null;
  onRequests = h.requests || null;
  onIncoming = h.incoming || null;
}

export function startRealtime() {
  stopped = false;
  connect();
}

export function stopRealtime() {
  stopped = true;
  if (timer) window.clearTimeout(timer);
  timer = null;
  ws?.close(1000);
  ws = null;
  setState({ connected: false });
}

async function connect() {
  if (stopped) return;
  try {
    const { ticket } = await api.ticket();
    const socket = new WebSocket(`${WS_BASE}/ws?ticket=${encodeURIComponent(ticket)}`);
    ws = socket;
    socket.onopen = () => {
      const wasRetry = retry > 0;
      retry = 0;
      setState({ connected: true });
      if (wasRetry) resync();
    };
    socket.onmessage = (e) => {
      try {
        handle(JSON.parse(e.data));
      } catch {
        /* ignore malformed events */
      }
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      setState({ connected: false });
      schedule();
    };
  } catch {
    schedule();
  }
}

function schedule() {
  if (stopped || timer) return;
  retry += 1;
  const delay = Math.min(30000, 1000 * 2 ** Math.min(retry, 5)) * (0.75 + Math.random() * 0.5);
  timer = window.setTimeout(() => {
    timer = null;
    connect();
  }, delay);
}

async function resync() {
  await loadConversations().catch(() => undefined);
  const active = getState().activeConversation;
  if (active) await catchUp(active).catch(() => undefined);
}

export function sendTyping(conversationId: number, threadRootId: number | null = null) {
  const key = `${conversationId}:${threadRootId || 0}`;
  const now = Date.now();
  if (now - (lastTyping[key] || 0) < 3000 || !ws || ws.readyState !== WebSocket.OPEN) return;
  lastTyping[key] = now;
  ws.send(JSON.stringify({ type: "typing", conversation_id: conversationId, thread_root_id: threadRootId }));
}

function handle(ev: any) {
  const s = getState();
  const meId = s.me?.id;
  switch (ev.type) {
    case "message.created": {
      const m: Message = ev.message;
      const conv = s.conversations[m.conversation_id];
      if (!conv) {
        refreshConversation(m.conversation_id);
        break;
      }
      addMessage(m);
      if (m.thread_root_id == null || m.also_in_channel) {
        const mine = m.sender?.id === meId;
        const viewing = s.activeConversation === m.conversation_id && document.visibilityState === "visible";
        const counts = !mine && !viewing && !m.deleted;
        patchConversation(m.conversation_id, {
          last_message: { id: m.id, kind: m.kind, sender_id: m.sender?.id ?? null, sender_name: m.sender?.display_name ?? null, body: m.body.slice(0, 140), deleted: m.deleted, has_attachments: m.attachments.length > 0, created_at: m.created_at },
          last_message_at: m.created_at,
          unread_count: mine ? 0 : conv.unread_count + (counts ? 1 : 0),
          mention_count: conv.mention_count + (counts && meId != null && m.mentions.includes(meId) ? 1 : 0),
        });
      }
      // Typing stops when the message arrives.
      if (m.sender) clearTyping(m.conversation_id, m.sender.id);
      if (m.sender?.id !== meId) onIncoming?.(m);
      break;
    }
    case "message.updated":
      replaceMessage(ev.message);
      break;
    case "message.deleted":
      updateMessage(ev.conversation_id, ev.message_id, (m) => ({ ...m, deleted: true, body: "", attachments: [], moderation_reason: ev.moderation_reason ?? m.moderation_reason }));
      break;
    case "reaction.updated":
      setReactions(ev.conversation_id, ev.message_id, ev.reactions);
      break;
    case "read.updated":
      if (ev.user_id === meId) {
        refreshConversation(ev.conversation_id);
      } else {
        setState((st) => ({ readStates: { ...st.readStates, [ev.conversation_id]: { ...(st.readStates[ev.conversation_id] || {}), [ev.user_id]: ev.last_read_message_id } } }));
      }
      break;
    case "typing": {
      const until = Date.now() + 5000;
      setState((st) => ({
        typing: { ...st.typing, [ev.conversation_id]: { ...(st.typing[ev.conversation_id] || {}), [ev.user.id]: { name: ev.user.display_name, until, thread: ev.thread_root_id || null } } },
      }));
      window.setTimeout(() => setState((st) => ({ typing: { ...st.typing } })), 5100);
      break;
    }
    case "presence.updated":
      setState((st) => {
        const conversations = { ...st.conversations };
        for (const c of Object.values(conversations)) {
          const other = c.other_user;
          if (other && other.id === ev.user_id) conversations[c.id] = { ...c, other_user: { ...other, online: !!ev.online } };
        }
        return { conversations };
      });
      break;
    case "conversation.cleared": // an admin emptied a community's chat: load it again from scratch
      setState((s) => {
        const messages = { ...s.messages };
        delete messages[ev.conversation_id];
        return { messages };
      });
      if (getState().activeConversation === ev.conversation_id) loadMessages(ev.conversation_id).catch(() => undefined);
      refreshConversation(ev.conversation_id).catch(() => undefined);
      break;
    case "conversation.changed":
      refreshConversation(ev.conversation_id);
      break;
    case "membership.removed":
      removeConversation(ev.conversation_id);
      onRemoved?.(ev.conversation_id);
      break;
    case "requests.changed":
      onRequests?.();
      break;
    // Board: the screens listen through onBoardEvent; my plans change with sign-ups and edits.
    case "post.created":
    case "post.updated":
    case "post.deleted":
    case "comment.created":
    case "attendance.changed":
      emitBoardEvent(ev);
      if (ev.type !== "comment.created") refreshMyPlansSoon();
      break;
  }
}

function clearTyping(conversationId: number, userId: number) {
  setState((st) => {
    const conv = st.typing[conversationId];
    if (!conv?.[userId]) return {};
    const next = { ...conv };
    delete next[userId];
    return { typing: { ...st.typing, [conversationId]: next } };
  });
}
