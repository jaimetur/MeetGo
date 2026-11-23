import { useSyncExternalStore } from "react";
import { api } from "./api";
import type { BillingStatus, Conversation, Me, Message, Reaction } from "./types";

export type MessageList = { items: Message[]; hasMoreBefore: boolean; loaded: boolean; loading: boolean };
export type Thread = { root: Message | null; items: Message[]; loaded: boolean };
export type Toast = { id: number; text: string; kind: "info" | "error" };

export type State = {
  me: Me | null;
  conversations: Record<number, Conversation>;
  loadedConversations: boolean;
  messages: Record<number, MessageList>;
  threads: Record<number, Thread>;
  typing: Record<number, Record<number, { name: string; until: number; thread: number | null }>>;
  readStates: Record<number, Record<number, number>>;
  billing: BillingStatus | null;
  requests: { friends: number; dms: number };
  connected: boolean;
  activeConversation: number | null;
  toasts: Toast[];
  paywall: boolean;
};

const initial: State = {
  me: null,
  conversations: {},
  loadedConversations: false,
  messages: {},
  threads: {},
  typing: {},
  readStates: {},
  billing: null,
  requests: { friends: 0, dms: 0 },
  connected: false,
  activeConversation: null,
  toasts: [],
  paywall: false,
};

let state: State = initial;
const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function resetState() {
  state = initial;
  listeners.forEach((l) => l());
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

// ---------- toasts ----------
let toastId = 0;
export function toast(text: string, kind: "info" | "error" = "info") {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  window.setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4500);
}

// ---------- conversations ----------
export async function loadConversations() {
  const list = await api.conversations();
  const map: Record<number, Conversation> = {};
  list.forEach((c) => (map[c.id] = c));
  setState({ conversations: map, loadedConversations: true });
}

export async function refreshConversation(id: number) {
  try {
    const c = await api.conversation(id);
    setState((s) => ({ conversations: { ...s.conversations, [id]: { ...s.conversations[id], ...c } } }));
  } catch (e: any) {
    if (e?.status === 404) removeConversation(id);
  }
}

export function removeConversation(id: number) {
  setState((s) => {
    const conversations = { ...s.conversations };
    delete conversations[id];
    return { conversations };
  });
}

export function patchConversation(id: number, patch: Partial<Conversation>) {
  setState((s) => (s.conversations[id] ? { conversations: { ...s.conversations, [id]: { ...s.conversations[id], ...patch } } } : {}));
}

export function sortedConversations(conversations: Record<number, Conversation>): Conversation[] {
  return Object.values(conversations).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.last_message_at || "").localeCompare(a.last_message_at || "");
  });
}

// ---------- messages ----------
function withMe(m: Message): Message {
  const meId = state.me?.id;
  return { ...m, reactions: m.reactions.map((r) => ({ ...r, me: r.me ?? (meId != null && r.user_ids.includes(meId)) })) };
}

export function inMainStream(m: Message) {
  return m.thread_root_id == null || m.also_in_channel;
}

function upsert(items: Message[], m: Message): Message[] {
  const idx = items.findIndex((x) => x.id === m.id || (m.client_id && x.client_id === m.client_id));
  if (idx >= 0) {
    const next = items.slice();
    next[idx] = { ...m };
    return next;
  }
  // Keep order by id; optimistic messages (negative ids) stay at the end.
  const next = items.concat(m);
  return next.sort((a, b) => (a.id < 0 ? Infinity : a.id) - (b.id < 0 ? Infinity : b.id));
}

export async function loadMessages(conversationId: number, older = false) {
  const list = state.messages[conversationId];
  if (list?.loading || (older && !list?.hasMoreBefore)) return;
  setState((s) => ({ messages: { ...s.messages, [conversationId]: { ...(list || { items: [], hasMoreBefore: true, loaded: false }), loading: true } } }));
  try {
    const before = older ? list?.items.find((m) => m.id > 0)?.id : undefined;
    const page = await api.messages(conversationId, { before_id: before, limit: 50 });
    setState((s) => {
      const current = s.messages[conversationId];
      const incoming = page.messages.map(withMe);
      const items = older && current ? incoming.concat(current.items) : mergeNewer(current?.items || [], incoming);
      return { messages: { ...s.messages, [conversationId]: { items, hasMoreBefore: page.has_more_before, loaded: true, loading: false } } };
    });
  } catch (e) {
    setState((s) => ({ messages: { ...s.messages, [conversationId]: { ...(s.messages[conversationId] || { items: [], hasMoreBefore: true, loaded: false }), loading: false } } }));
    throw e;
  }
}

function mergeNewer(existing: Message[], incoming: Message[]) {
  let items = incoming;
  for (const m of existing) if (m.id < 0 || !items.some((x) => x.id === m.id)) items = upsert(items, m);
  return items;
}

/** After a reconnection: fetch what arrived meanwhile in the open conversation. */
export async function catchUp(conversationId: number) {
  const list = state.messages[conversationId];
  if (!list?.loaded) return;
  const lastId = [...list.items].reverse().find((m) => m.id > 0)?.id;
  if (!lastId) return loadMessages(conversationId);
  const page = await api.messages(conversationId, { after_id: lastId, limit: 100 });
  page.messages.forEach((m) => addMessage(m));
}

export async function loadThread(rootId: number, conversationId: number) {
  const page = await api.messages(conversationId, { thread_root_id: rootId, limit: 100 });
  setState((s) => ({ threads: { ...s.threads, [rootId]: { root: page.thread_root ? withMe(page.thread_root) : null, items: page.messages.map(withMe), loaded: true } } }));
}

export function addMessage(raw: Message) {
  const m = withMe(raw);
  setState((s) => {
    const patch: Partial<State> = {};
    if (inMainStream(m)) {
      const list = s.messages[m.conversation_id];
      if (list?.loaded) patch.messages = { ...s.messages, [m.conversation_id]: { ...list, items: upsert(list.items, m) } };
    }
    if (m.thread_root_id) {
      const th = s.threads[m.thread_root_id];
      if (th?.loaded) patch.threads = { ...s.threads, [m.thread_root_id]: { ...th, items: upsert(th.items, m) } };
    }
    return patch;
  });
}

export function replaceMessage(raw: Message) {
  const m = withMe(raw);
  setState((s) => {
    const patch: Partial<State> = {};
    const list = s.messages[m.conversation_id];
    if (list?.items.some((x) => x.id === m.id)) {
      patch.messages = { ...s.messages, [m.conversation_id]: { ...list, items: list.items.map((x) => (x.id === m.id ? m : x)) } };
    }
    const threads = { ...s.threads };
    let changed = false;
    for (const [rootId, th] of Object.entries(threads)) {
      if (th.root?.id === m.id) {
        threads[+rootId] = { ...th, root: m };
        changed = true;
      } else if (th.items.some((x) => x.id === m.id)) {
        threads[+rootId] = { ...th, items: th.items.map((x) => (x.id === m.id ? m : x)) };
        changed = true;
      }
    }
    if (changed) patch.threads = threads;
    return patch;
  });
}

export function updateMessage(conversationId: number, messageId: number, fn: (m: Message) => Message) {
  setState((s) => {
    const patch: Partial<State> = {};
    const list = s.messages[conversationId];
    if (list?.items.some((x) => x.id === messageId)) {
      patch.messages = { ...s.messages, [conversationId]: { ...list, items: list.items.map((x) => (x.id === messageId ? fn(x) : x)) } };
    }
    const threads = { ...s.threads };
    let changed = false;
    for (const [rootId, th] of Object.entries(threads)) {
      if (th.root?.id === messageId) {
        threads[+rootId] = { ...th, root: fn(th.root) };
        changed = true;
      }
      if (th.items.some((x) => x.id === messageId)) {
        threads[+rootId] = { ...threads[+rootId], items: threads[+rootId].items.map((x) => (x.id === messageId ? fn(x) : x)) };
        changed = true;
      }
    }
    if (changed) patch.threads = threads;
    return patch;
  });
}

export function setReactions(conversationId: number, messageId: number, reactions: Reaction[]) {
  const meId = state.me?.id;
  updateMessage(conversationId, messageId, (m) => ({ ...m, reactions: reactions.map((r) => ({ ...r, me: meId != null && r.user_ids.includes(meId) })) }));
}

export function removeLocal(conversationId: number, clientId: string) {
  setState((s) => {
    const list = s.messages[conversationId];
    if (!list) return {};
    return { messages: { ...s.messages, [conversationId]: { ...list, items: list.items.filter((x) => x.client_id !== clientId) } } };
  });
}
