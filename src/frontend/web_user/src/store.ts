import { useSyncExternalStore } from "react";
import { api } from "./api";
import type { BillingStatus, Community, Conversation, Me, Message, Post, Reaction } from "./types";

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
  // per chat and person: up to which message their app has it (delivered, ✓✓) and up to which they read it (blue)
  readStates: Record<number, Record<number, { read: number; delivered: number }>>;
  billing: BillingStatus | null;
  requests: { friends: number; dms: number; communities?: number };
  connected: boolean;
  activeConversation: number | null;
  toasts: Toast[];
  adminPending: number;  // administrators: category proposals waiting for review
  paywall: boolean;
  // Subscriptions switched on in the administration; while off, nothing about plans is shown.
  subscriptions: boolean;
  // Board: my upcoming plans and my communities (right column, Chats filters, Publish). null until loaded.
  myPlans: Post[] | null;
  myCommunities: Community[] | null;
  // categories of communities, in order (from the server; the built-in ones until it answers)
  categories: { key: string; name: string; icon: string | null; color: string | null; builtin: boolean }[] | null;
  // people I blocked: their messages are hidden from me
  blocked: number[];
  // another zone whose communities I am looking at (Communities), or null for mine
  // country + area (a group of provinces, e.g. an autonomous community) + province: the narrowest one set is the zone
  browseZone: { country: string; area?: string; province?: string; age_range: string; label: string } | null;
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
  adminPending: 0,
  paywall: false,
  subscriptions: false,
  myPlans: null,
  myCommunities: null,
  categories: null,
  blocked: [],
  browseZone: null,
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
  // what was sent to me while I was away has now reached my app: the senders see ✓✓
  api.deliveredAll().catch(() => undefined);
}

/** One person's receipts in a chat (from the read-state list or a live event). */
export function setReceipt(convId: number, userId: number, patch: { read?: number; delivered?: number }) {
  setState((st) => {
    const conv = st.readStates[convId] || {};
    const cur = conv[userId] || { read: 0, delivered: 0 };
    const read = Math.max(cur.read, patch.read ?? 0);
    const delivered = Math.max(cur.delivered, patch.delivered ?? 0, read);
    return { readStates: { ...st.readStates, [convId]: { ...conv, [userId]: { read, delivered } } } };
  });
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

/** A chat deleted for me: out of the list and its loaded messages forgotten (they are gone for me). */
export function forgetConversation(id: number) {
  setState((s) => {
    const conversations = { ...s.conversations };
    const messages = { ...s.messages };
    delete conversations[id];
    delete messages[id];
    return { conversations, messages };
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

// ---------- board: my plans and my communities ----------
/** Upcoming plans I go to or organise (both lists, without repeats, by date). Empty if the API is not there. */
export async function loadMyPlans() {
  try {
    const [going, organizing] = await Promise.all([api.myPlans("upcoming"), api.myPlans("organizing").catch(() => [] as Post[])]);
    const byId = new Map<number, Post>();
    [...going, ...organizing].forEach((p) => byId.set(p.id, p));
    const list = [...byId.values()].filter((p) => !p.starts_at || new Date(p.ends_at || p.starts_at) >= new Date(Date.now() - 3 * 3600000));
    list.sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || ""));
    setState({ myPlans: list });
  } catch {
    setState((s) => ({ myPlans: s.myPlans || [] }));
  }
}

export async function loadCategories() {
  try {
    const list = await api.categories();
    const { setCategories } = await import("./ui/Communities");
    setCategories(list);
    setState({ categories: list });
  } catch {
    /* the built-in ones stay */
  }
}

/** Administrators: how many category proposals wait for review (one reviewed by anyone disappears for all). */
export async function loadAdminPending() {
  if (getState().me?.role !== "admin") return;
  try {
    const p = await api.adminPending();
    setState({ adminPending: p.categories });
  } catch { /* not now: next time */ }
}

export async function loadMyCommunities() {
  try {
    setState({ myCommunities: await api.communities({ mine: true }) });
  } catch {
    setState((s) => ({ myCommunities: s.myCommunities || [] }));
  }
}

let planTimer: number | null = null;
/** Several changes in a row reload the plans once. */
export function refreshMyPlansSoon() {
  if (planTimer) window.clearTimeout(planTimer);
  planTimer = window.setTimeout(() => {
    planTimer = null;
    loadMyPlans();
  }, 600);
}

export async function loadBlocks() {
  try {
    const list = await api.blocks();
    setState({ blocked: list.map((u) => u.id) });
  } catch {
    /* not critical */
  }
}
