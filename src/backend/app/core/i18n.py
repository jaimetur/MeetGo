from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
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


def _unquote(value: str) -> str:
    """Drop exactly the outer quotes of a PO string (an escaped quote at the end stays)."""
    value = value.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return value[1:-1]
    return value


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
            msgid = _unescape_po(_unquote(line[6:]))
            continue
        if line.startswith("msgstr "):
            mode = "str"
            msgstr = _unescape_po(_unquote(line[7:]))
            continue
        if line.startswith('"'):
            val = _unescape_po(_unquote(line))
            if mode == "id":
                msgid = (msgid or "") + val
            elif mode == "str":
                msgstr = (msgstr or "") + val
    commit()
    return out


def _load_lang(lang: str) -> dict[str, str]:
    if lang in _dicts:
        return _dicts[lang]
    # lang/ is at the repository root (src/backend/app/core/i18n.py) or next to the code in the image (/srv/lang).
    path = next((p / "lang" / f"{lang}.po" for p in Path(__file__).resolve().parents if (p / "lang" / f"{lang}.po").exists()),
                Path("lang") / f"{lang}.po")
    if not path.exists():  # a language added from the administration (translated by Claude)
        path = extra_dir() / f"{lang}.po"
    if not path.exists():
        _dicts[lang] = {}
        return _dicts[lang]
    data = _parse_po(path.read_text(encoding="utf-8"))
    _dicts[lang] = data
    return data


def builtin_dir() -> Path:
    return next((p / "lang" for p in Path(__file__).resolve().parents if (p / "lang" / "en.po").exists()), Path("lang"))


def extra_dir() -> Path:
    """Languages added from the administration: <DATA_DIR>/lang/<code>.po."""
    from app.core.config import settings
    return Path(settings.DATA_DIR) / "lang"


@lru_cache(maxsize=1)
def supported() -> frozenset[str]:
    """Every lang/<code>.po is a language (English is the source), and so is every language added later."""
    codes = {f.stem for f in builtin_dir().glob("*.po")} | {f.stem for f in extra_dir().glob("*.po")}
    return frozenset(codes) or frozenset({"en"})


def reload(lang: str | None = None) -> None:
    """Forget what was read (after a language is added, translated further or deleted)."""
    if lang:
        _dicts.pop(lang, None)
    else:
        _dicts.clear()
    supported.cache_clear()


def _valid(lang: str | None) -> str:
    return lang if lang in supported() else "en"


def select_lang(header: str | None) -> str:
    """The first language of X-Lang / Accept-Language that MeetGo has ("fr-FR,fr;q=0.9" → "fr")."""
    if not header:
        return "es"
    langs = supported()
    for part in header.lower().split(","):
        code = part.split(";")[0].strip().split("-")[0]
        if code in langs:
            return code
    return "en"


def set_lang(lang: str) -> None:
    _lang_var.set(_valid(lang))


def get_lang() -> str:
    return _lang_var.get()


@contextmanager
def use_lang(lang: str | None):
    """Write in another language for a moment (emails go out in the language of the person who gets them)."""
    token = _lang_var.set(_valid(lang))
    try:
        yield
    finally:
        _lang_var.reset(token)


def t(key: str, vars: dict[str, str | int] | None = None) -> str:
    lang = get_lang()
    d = _load_lang(lang) if lang not in _dicts else _dicts[lang]
    if "en" not in _dicts:
        _load_lang("en")
    s = d.get(key) or _dicts.get("en", {}).get(key) or key  # English is the source language
    if vars:
        for k, v in vars.items():
            s = s.replace(f"{{{k}}}", str(v))
    return s
