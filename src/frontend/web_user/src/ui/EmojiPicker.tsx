/** Every emoji, by category as in WhatsApp, with the ones I use most (and most recently) on top. The picker stays
 * open so several can be added; what I use is remembered on this device. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@lang";
import { Icon } from "./common";
import { EMOJI_GROUPS } from "./emojiData";

const RECENT_KEY = "emoji.recent";
const RECENT_MAX = 24;
type Usage = Record<string, [number, number]>; // emoji → [times used, last time]

function readUsage(): Usage {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

/** The most used first; equal use, the most recent. */
export function recentEmojis(): string[] {
  const u = readUsage();
  return Object.keys(u).sort((a, b) => u[b][0] - u[a][0] || u[b][1] - u[a][1]).slice(0, RECENT_MAX);
}

export function rememberEmoji(e: string) {
  const u = readUsage();
  u[e] = [(u[e]?.[0] || 0) + 1, Date.now()];
  // keep the list small: the least used and oldest go
  const keys = Object.keys(u);
  if (keys.length > 80) keys.sort((a, b) => u[a][0] - u[b][0] || u[a][1] - u[b][1]).slice(0, keys.length - 80).forEach((k) => delete u[k]);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(u));
  } catch {
    /* private mode: no memory */
  }
}

const ALL = EMOJI_GROUPS.flatMap((g) => g.emojis.map((e, i) => ({ e, name: g.names[i], words: g.names[i].split(/[\s\-_,.’'&]+/) })));
const SEARCH_MAX = 160;

/** By English name (Unicode's): every word I type starts a word of the name ("red hea" → ❤️); the exact name first,
 * then the names that start with what I typed. */
export function searchEmojis(query: string): { e: string; name: string }[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const full = terms.join(" ");
  const hits = ALL.filter((x) => terms.every((term) => x.words.some((w) => w.startsWith(term))));
  const rank = (x: { name: string }) => (x.name === full ? 0 : x.name.startsWith(full) ? 1 : 2);
  return hits.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).slice(0, SEARCH_MAX).map(({ x }) => ({ e: x.e, name: x.name }));
}

export function EmojiPicker({ onPick, className = "" }: { onPick: (e: string) => void; className?: string }) {
  // read once: the recent row does not reorder while I pick (it would move under my finger); it updates next time
  const [recent] = useState(recentEmojis);
  const pages = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const groups = useMemo(() => [
    ...(recent.length ? [{ key: "recent", icon: "🕘", emojis: recent }] : []),
    ...EMOJI_GROUPS,
  ], [recent]);
  const [q, setQ] = useState("");
  const found = useMemo(() => searchEmojis(q), [q]);
  const searching = !!q.trim();
  const want = useRef<number | null>(null);  // the page to show once the search is gone

  // one page per category, side by side: a swipe goes to the next or previous one, as in WhatsApp
  useEffect(() => {
    if (searching || want.current == null || !pages.current) return;
    pages.current.scrollLeft = want.current * pages.current.clientWidth;
    want.current = null;
  }, [searching]);

  function pick(e: string) {
    rememberEmoji(e);
    onPick(e);
  }
  function go(i: number) {
    setActive(i);
    if (searching) {
      want.current = i;
      setQ("");
      return;
    }
    const el = pages.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }
  function onScroll() {
    const el = pages.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== active) setActive(i);
  }

  return (
    // a tap on an emoji keeps the focus (and the keyboard) where it was; the search box takes it
    <div className={"epick " + className} onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}>
      <div className="epick-search">
        <Icon name="search" size="sm" />
        <input type="search" value={q} onChange={(e) => { if (!searching) want.current = active; setQ(e.target.value); }}
          placeholder={t("ui_emoji_search")} aria-label={t("ui_emoji_search")} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
      </div>
      <div className="epick-tabs" role="tablist">
        {groups.map((g, i) => (
          <button type="button" key={g.key} role="tab" aria-selected={!searching && active === i} className={!searching && active === i ? "on" : ""}
            title={t("ui_emoji_" + g.key)} aria-label={t("ui_emoji_" + g.key)} onClick={() => go(i)}>{g.icon}</button>
        ))}
      </div>
      {searching ? (
        <div className="epick-body">
          {found.length
            ? <div className="epick-grid epick-found">{found.map((x) => <button type="button" key={x.e} title={x.name} onClick={() => pick(x.e)}>{x.e}</button>)}</div>
            : <div className="muted epick-none">{t("ui_emoji_no_results")}</div>}
        </div>
      ) : (
        <div className="epick-pages" ref={pages} onScroll={onScroll}>
          {groups.map((g) => (
            <section key={g.key} className="epick-page" data-g={g.key}>
              <div className="epick-title">{t("ui_emoji_" + g.key)}</div>
              <div className="epick-grid">
                {g.emojis.map((e) => <button type="button" key={e} onClick={() => pick(e)}>{e}</button>)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
