import React, { useRef, useState } from "react";
import { t } from "@lang";
import { EMOJIS, Icon } from "./common";

/*
 * A small, safe text format for community and group rules (no HTML is ever injected):
 *   # Heading / ## Subheading      - item / * item / 1. item      > callout
 *   **bold**  *italic*  __underline__  ~~strike~~  {red}coloured text{/}   links and emojis as typed
 */

export const RICH_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;
const COLOR_RE = new RegExp(`\\{(${RICH_COLORS.join("|")})\\}([\\s\\S]*?)\\{\\/\\}`);
const INLINE = /(\*\*([^*]+)\*\*)|(__([^_]+)__)|(~~([^~]+)~~)|(\*([^*]+)\*)|(https?:\/\/[^\s)]+)/;

function inline(text: string, key = "i"): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const color = COLOR_RE.exec(rest);
    const fmt = INLINE.exec(rest);
    const next = [color, fmt].filter(Boolean).sort((a, b) => a!.index - b!.index)[0];
    if (!next) {
      out.push(rest);
      break;
    }
    if (next.index > 0) out.push(rest.slice(0, next.index));
    const k = `${key}-${n++}`;
    if (next === color) {
      out.push(<span key={k} className={`rt-c rt-${color![1]}`}>{inline(color![2], k)}</span>);
    } else if (fmt![2]) out.push(<strong key={k}>{inline(fmt![2], k)}</strong>);
    else if (fmt![4]) out.push(<u key={k}>{inline(fmt![4], k)}</u>);
    else if (fmt![6]) out.push(<s key={k}>{inline(fmt![6], k)}</s>);
    else if (fmt![8]) out.push(<em key={k}>{inline(fmt![8], k)}</em>);
    else if (fmt![9]) out.push(<a key={k} href={fmt![9]} target="_blank" rel="noopener noreferrer nofollow">{fmt![9]}</a>);
    rest = rest.slice(next.index + next[0].length);
  }
  return out;
}

/** Renders rules written in the format above. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length} className="rt-list">{items}</ol> : <ul key={blocks.length} className="rt-list">{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || number) {
      const ordered = !!number;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet || number)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const k = blocks.length;
    if (line.startsWith("## ")) blocks.push(<h4 key={k} className="rt-h2">{inline(line.slice(3), `h${k}`)}</h4>);
    else if (line.startsWith("# ")) blocks.push(<h3 key={k} className="rt-h1">{inline(line.slice(2), `h${k}`)}</h3>);
    else if (line.startsWith("> ")) blocks.push(<div key={k} className="rt-callout">{inline(line.slice(2), `c${k}`)}</div>);
    else blocks.push(<p key={k} className="rt-p">{inline(line, `p${k}`)}</p>);
  }
  flush();
  return <div className={"richtext" + (className ? " " + className : "")}>{blocks}</div>;
}

/** Textarea with a toolbar for the format above and a preview. */
export function RichEditor({ id, value, onChange, rows = 7, maxLength = 4000 }: {
  id: string; value: string; onChange: (v: string) => void; rows?: number; maxLength?: number;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [panel, setPanel] = useState<"" | "color" | "emoji">("");

  function wrap(before: string, after = before, placeholder = t("ui_rt_text")) {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = value.slice(a, b) || placeholder;
    const next = value.slice(0, a) + before + sel + after + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + before.length, a + before.length + sel.length);
    });
  }
  function linePrefix(prefix: string) {
    const el = area.current;
    if (!el) return;
    const start = value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    onChange(value.slice(0, start) + prefix + value.slice(start));
    requestAnimationFrame(() => el.focus());
  }
  function insert(text: string) {
    const el = area.current;
    const at = el ? el.selectionStart : value.length;
    onChange(value.slice(0, at) + text + value.slice(at));
    setPanel("");
    requestAnimationFrame(() => el?.focus());
  }

  return (
    <div className="rteditor">
      <div className="rt-toolbar" role="toolbar" aria-label={t("ui_rt_toolbar")}>
        <button type="button" onClick={() => wrap("**")} title={t("ui_rt_bold")} aria-label={t("ui_rt_bold")}><b>B</b></button>
        <button type="button" onClick={() => wrap("*")} title={t("ui_rt_italic")} aria-label={t("ui_rt_italic")}><i>I</i></button>
        <button type="button" onClick={() => wrap("__")} title={t("ui_rt_underline")} aria-label={t("ui_rt_underline")}><u>U</u></button>
        <button type="button" onClick={() => wrap("~~")} title={t("ui_rt_strike")} aria-label={t("ui_rt_strike")}><s>S</s></button>
        <button type="button" onClick={() => linePrefix("# ")} title={t("ui_rt_heading")} aria-label={t("ui_rt_heading")}>H</button>
        <button type="button" onClick={() => linePrefix("- ")} title={t("ui_rt_list")} aria-label={t("ui_rt_list")}>•</button>
        <button type="button" onClick={() => linePrefix("> ")} title={t("ui_rt_callout")} aria-label={t("ui_rt_callout")}><Icon name="info" size="sm" /></button>
        <button type="button" className={panel === "color" ? "on" : ""} onClick={() => setPanel(panel === "color" ? "" : "color")} title={t("ui_rt_color")} aria-label={t("ui_rt_color")}><span className="rt-swatch rt-grad" /></button>
        <button type="button" className={panel === "emoji" ? "on" : ""} onClick={() => setPanel(panel === "emoji" ? "" : "emoji")} title={t("ui_emoji")} aria-label={t("ui_emoji")}><Icon name="smile" size="sm" /></button>
        <span className="grow" />
        <button type="button" className={"rt-prev" + (preview ? " on" : "")} onClick={() => setPreview((v) => !v)}>{preview ? t("ui_rt_edit") : t("ui_rt_preview")}</button>
      </div>
      {panel === "color" ? (
        <div className="rt-panel">
          {RICH_COLORS.map((c) => <button type="button" key={c} className={`rt-swatch rt-bg-${c}`} onClick={() => { wrap(`{${c}}`, "{/}"); setPanel(""); }} aria-label={c} />)}
        </div>
      ) : null}
      {panel === "emoji" ? (
        <div className="rt-panel emojis-inline">
          {["✅", "❌", "⚠️", "🚫", "💬", "🤝", "📌", "📅", "📍", "🔒", "⭐", "❤️", ...EMOJIS].slice(0, 40).map((e, i) => <button type="button" key={e + i} onClick={() => insert(e)}>{e}</button>)}
        </div>
      ) : null}
      {preview ? (
        <div className="rt-preview">{value.trim() ? <RichText text={value} /> : <span className="muted">{t("ui_rt_empty")}</span>}</div>
      ) : (
        <textarea id={id} ref={area} className="inp" rows={rows} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      <div className="rt-help muted">{t("ui_rt_help")}</div>
    </div>
  );
}
