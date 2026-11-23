// English (en.po) is the source language: every other catalog is a translation of it, and anything
// missing in a translation falls back to English. See lang/README.md.
export type Lang = "es" | "en";

type Dict = Record<string, string>;

import esPo from "./es.po?raw";
import enPo from "./en.po?raw";

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

const DICTS: Record<Lang, Dict> = {
  es: parsePo(esPo),
  en: parsePo(enPo),
};

export function getLang(): Lang {
  const v = (localStorage.getItem("lang") || "es") as Lang;
  return v === "en" ? "en" : "es";
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
