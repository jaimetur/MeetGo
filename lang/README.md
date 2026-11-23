# Translations

**English is the source language.** `en.po` has every text of MeetGo (the API, the web app, the
administration and the landing page); every other file is a translation of it. Anything missing in a
translation is shown in English.

| File | Language |
|---|---|
| `en.po` | English: source, edit texts here first |
| `es.po`, `ca.po`, `fr.po`, `it.po`, `de.po`, `pt.po`, `nl.po`, `zh.po`, `ja.po` | translations |
| `lang.ts` | loads the catalogs in the web sites (`t()`, `translate()`) |

Each entry has a key and its text. Keys never change and are never translated:

```po
msgid "ui_home_page"
msgstr "Home page"
```

- `{name}`, `{n}`, `{date}`… are filled in by the app: keep them as they are.
- Some landing texts (`landing_*`) contain HTML such as `<span class="go">…</span>`: translate the words
  and keep the tags.

## Adding a language

1. Copy `en.po` to `<code>.po` (for example `fr.po`) and set `"Language: fr\n"` in its header.
2. Translate every `msgstr`, leaving the `msgid` lines alone.
3. Check it: `python3 tools/i18n_check.py` lists missing, extra and broken entries in every language.
4. That is all: every `lang/<code>.po` shows up in the language pickers (add its own name to `LANGUAGE_NAMES` in `lang.ts`).

## Changing or adding a text

Change or add it in `en.po` first, then in the other languages. `tools/i18n_check.py` shows what is
left to translate.
