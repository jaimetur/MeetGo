from __future__ import annotations

from contextvars import ContextVar
from pathlib import Path

Lang = str

_lang_var: ContextVar[Lang] = ContextVar("meetgo_lang", default="es")
_dicts: dict[str, dict[str, str]] = {}


def _unescape_po(value: str) -> str:
    return (
        value.replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\r", "\r")
        .replace("\\\\", "\\")
        .replace('\\"', '"')
    )


def _parse_po(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    msgid: str | None = None
    msgstr: str | None = None
    mode: str | None = None

    def commit() -> None:
        nonlocal msgid, msgstr, mode
        if msgid is not None and msgid != "" and msgstr is not None:
            out[msgid] = msgstr
        msgid = None
        msgstr = None
        mode = None

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            commit()
            continue
        if line.startswith("#"):
            continue
        if line.startswith("msgid "):
            commit()
            mode = "id"
            msgid = _unescape_po(line[6:].strip().strip('"'))
            continue
        if line.startswith("msgstr "):
            mode = "str"
            msgstr = _unescape_po(line[7:].strip().strip('"'))
            continue
        if line.startswith('"'):
            val = _unescape_po(line.strip().strip('"'))
            if mode == "id":
                msgid = (msgid or "") + val
            elif mode == "str":
                msgstr = (msgstr or "") + val
    commit()
    return out


def _load_lang(lang: str) -> dict[str, str]:
    if lang in _dicts:
        return _dicts[lang]
    base = Path(__file__).resolve().parents[1] / "lang"
    path = base / f"{lang}.po"
    if not path.exists():
        alt = Path(__file__).resolve().parents[2] / "lang" / f"{lang}.po"
        path = alt
    if not path.exists():
        _dicts[lang] = {}
        return _dicts[lang]
    data = _parse_po(path.read_text(encoding="utf-8"))
    _dicts[lang] = data
    return data


def select_lang(header: str | None) -> str:
    if not header:
        return "es"
    value = header.lower()
    if "en" in value:
        return "en"
    if "es" in value:
        return "es"
    return "es"


def set_lang(lang: str) -> None:
    _lang_var.set("en" if lang == "en" else "es")


def get_lang() -> str:
    return _lang_var.get()


def t(key: str, vars: dict[str, str | int] | None = None) -> str:
    lang = get_lang()
    if not _dicts:
        _load_lang("es")
        _load_lang("en")
    d = _dicts.get(lang, {})
    s = d.get(key) or _dicts.get("es", {}).get(key) or key
    if vars:
        for k, v in vars.items():
            s = s.replace(f"{{{k}}}", str(v))
    return s
