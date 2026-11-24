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

/**
 * What the administration decided: languages switched off leave the pickers, and languages added there (translated by
 * Claude) join them with their texts. Called once, before the app is drawn.
 */
export function configureLanguages(disabled: string[], added: { code: string; name: string; texts?: Dict }[]) {
  for (const { code, name, texts } of added) {
    if (texts) DICTS[code] = texts;
    LANGUAGE_NAMES[code] = name;
    if (!LANGUAGES.some(([c]) => c === code)) LANGUAGES.push([code, name]);
  }
  for (let i = LANGUAGES.length - 1; i >= 0; i--) {
    if (disabled.includes(LANGUAGES[i][0]) && LANGUAGES[i][0] !== "en") LANGUAGES.splice(i, 1);
  }
}

/** A language added from the administration whose texts are not loaded yet. */
export function needsTexts(code: string): boolean {
  return !!code && !DICTS[code];
}

/** The first of the browser's languages that MeetGo has, or English. */
export function browserLang(): Lang {
  const wanted = typeof navigator === "undefined" ? [] : [...(navigator.languages || []), navigator.language];
  for (const tag of wanted) {
    const code = (tag || "").toLowerCase().split("-")[0];
    if (DICTS[code]) return code;
  }
  return "en";
}

export function storedLang(): string {
  try {
    return localStorage.getItem("lang") || "";
  } catch {
    return ""; /* private mode */
  }
}

export function getLang(): Lang {
  const stored = storedLang();
  return DICTS[stored] ? stored : browserLang();
}

export function setLang(l: Lang) {
  localStorage.setItem("lang", l);
  // a language added from the administration brings its texts when the app starts: start it again
  if (!DICTS[l] && typeof window !== "undefined") window.location.reload();
}

export function t(key: string, vars?: Record<string, string | number>) {
  return translate(getLang(), key, vars);
}

/** The text of `key` in `lang` (the landing page keeps its own language choice). */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>) {
  const dict = DICTS[lang] || DICTS.en;
  // "1 member", not "1 members": a count of one uses <key>_one when the language has it.
  const one = vars && Number(vars.n) === 1 ? dict[`${key}_one`] : undefined;
  let s = one || dict[key] || DICTS.en[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
