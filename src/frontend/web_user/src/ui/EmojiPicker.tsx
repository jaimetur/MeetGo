/** Every emoji, by category as in WhatsApp, with the ones I use most (and most recently) on top. The picker stays
 * open so several can be added; what I use is remembered on this device. */
import React, { useMemo, useRef, useState } from "react";
import { t } from "@lang";
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

export function EmojiPicker({ onPick, className = "" }: { onPick: (e: string) => void; className?: string }) {
  // read once: the recent row does not reorder while I pick (it would move under my finger); it updates next time
  const [recent] = useState(recentEmojis);
  const body = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(recent.length ? "recent" : "smileys");
  const groups = useMemo(() => [
    ...(recent.length ? [{ key: "recent", icon: "🕘", emojis: recent }] : []),
    ...EMOJI_GROUPS,
  ], [recent]);

  function pick(e: string) {
    rememberEmoji(e);
    onPick(e);
  }
  function go(key: string) {
    const sec = body.current?.querySelector<HTMLElement>(`[data-g="${key}"]`);
    if (sec && body.current) body.current.scrollTop = sec.offsetTop;  // at once, as WhatsApp
    setActive(key);
  }
  function onScroll() {
    const b = body.current;
    if (!b) return;
    let cur = groups[0]?.key;
    for (const g of groups) {
      const sec = b.querySelector<HTMLElement>(`[data-g="${g.key}"]`);
      if (sec && sec.offsetTop <= b.scrollTop + 8) cur = g.key;
    }
    if (cur && cur !== active) setActive(cur);
  }

  return (
    <div className={"epick " + className} onMouseDown={(e) => e.preventDefault()}>
      <div className="epick-tabs" role="tablist">
        {groups.map((g) => (
          <button type="button" key={g.key} role="tab" aria-selected={active === g.key} className={active === g.key ? "on" : ""}
            title={t("ui_emoji_" + g.key)} aria-label={t("ui_emoji_" + g.key)} onClick={() => go(g.key)}>{g.icon}</button>
        ))}
      </div>
      <div className="epick-body" ref={body} onScroll={onScroll}>
        {groups.map((g) => (
          <section key={g.key} data-g={g.key}>
            <div className="epick-title">{t("ui_emoji_" + g.key)}</div>
            <div className="epick-grid">
              {g.emojis.map((e) => <button type="button" key={e} onClick={() => pick(e)}>{e}</button>)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
