// English (en.po) is the source language: every other catalog is a translation of it, and anything
// missing in a translation falls back to English. See lang/README.md.
export type Lang = string;

type Dict = Record<string, string>;

// Every lang/<code>.po is a language: adding a file is enough (see lang/README.md).
const FILES = import.meta.glob("./*.po", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Names of the languages in their own language, in the order the pickers show them. */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Español", ca: "Català", fr: "Français", it: "Italiano", de: "Deutsch", pt: "Português",
  nl: "Nederlands", zh: "中文", ja: "日本語",
};

function unescapePo(s: string) {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"');
}

function parsePo(input: string): Dict {
  const dict: Dict = {};
  let msgid: string | null = null;
  let msgstr: string | null = null;
  let mode: "id" | "str" | null = null;

  const lines = input.split(/\r?\n/);
  const commit = () => {
    if (msgid !== null && msgid !== "" && msgstr !== null) {
      dict[msgid] = msgstr;
    }
    msgid = null;
    msgstr = null;
    mode = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      commit();
      continue;
    }
    if (line.startsWith("#")) continue;

    if (line.startsWith("msgid ")) {
      commit();
      mode = "id";
      msgid = unescapePo(line.slice(6).replace(/^"|"$/g, ""));
      continue;
    }
    if (line.startsWith("msgstr ")) {
      mode = "str";
      msgstr = unescapePo(line.slice(7).replace(/^"|"$/g, ""));
      continue;
    }
    if (line.startsWith('"')) {
      const val = unescapePo(line.replace(/^"|"$/g, ""));
      if (mode === "id") msgid = (msgid || "") + val;
      if (mode === "str") msgstr = (msgstr || "") + val;
    }
  }

  commit();
  return dict;
}

const DICTS: Record<Lang, Dict> = Object.fromEntries(
  Object.entries(FILES).map(([path, text]) => [path.replace(/^.*\//, "").replace(/\.po$/, ""), parsePo(text)]),
);

/** The languages available, as [code, name], English first. */
export const LANGUAGES: [Lang, string][] = Object.keys(DICTS)
  .sort((a, b) => (Object.keys(LANGUAGE_NAMES).indexOf(a) + 1 || 99) - (Object.keys(LANGUAGE_NAMES).indexOf(b) + 1 || 99))
  .map((code) => [code, LANGUAGE_NAMES[code] || code]);

/** The first of the browser's languages that MeetGo has, or English. */
export function browserLang(): Lang {
  const wanted = typeof navigator === "undefined" ? [] : [...(navigator.languages || []), navigator.language];
  for (const tag of wanted) {
    const code = (tag || "").toLowerCase().split("-")[0];
    if (DICTS[code]) return code;
  }
  return "en";
}

export function getLang(): Lang {
  let stored = "";
  try {
    stored = localStorage.getItem("lang") || "";
  } catch {
    /* private mode */
  }
  return DICTS[stored] ? stored : browserLang();
}

export function setLang(l: Lang) {
  localStorage.setItem("lang", l);
}

export function t(key: string, vars?: Record<string, string | number>) {
  return translate(getLang(), key, vars);
}

/** The text of `key` in `lang` (the landing page keeps its own language choice). */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>) {
  const dict = DICTS[lang] || DICTS.en;
  let s = dict[key] || DICTS.en[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
