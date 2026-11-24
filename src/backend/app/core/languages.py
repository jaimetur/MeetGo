"""The languages of MeetGo: the ones that come with it (lang/*.po) and the ones an administrator adds.

Adding a language translates every text of English (en.po) with Claude, in batches, into <DATA_DIR>/lang/<code>.po.
A batch that fails is left out and translated on the next run ("Complete the translation"); a text whose {placeholders}
or HTML tags do not match the English one is dropped (English is shown for it). The administrator can also switch any
language off: it stays in the files but leaves the language pickers.
"""

import asyncio
import json
import logging
import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ai
from app.core.app_settings import get_section, set_section
from app.core.i18n import _load_lang, builtin_dir, extra_dir, reload

logger = logging.getLogger("meetgo.languages")
SECTION = "i18n"  # {"disabled": [codes], "custom": {code: name}}
BATCH = 60

# Names of the languages that come with MeetGo (lang/lang.ts has the same list).
BUILTIN_NAMES = {"en": "English", "es": "Español", "ca": "Català", "fr": "Français", "it": "Italiano", "de": "Deutsch",
                 "pt": "Português", "nl": "Nederlands", "zh": "中文", "ja": "日本語"}

# Translation jobs running now: code -> {"done": n, "total": n, "state": "running" | "done" | "error", "error": "..."}
jobs: dict[str, dict] = {}

SYSTEM = (
    "You translate the interface of MeetGo, a social app where people of the same area chat in communities and meet "
    "up (plans, events). You receive texts as key/text pairs in English and return every key with its text translated "
    "into the target language: natural, short and friendly, as a native speaker would write an app's interface, with "
    "the informal 'you' where the language has one. Keep exactly as they are: every {placeholder} in braces, HTML tags "
    "such as <b> or <span class=\"go\">, line breaks, emoji, URLs, email addresses and the names MeetGo, Google Play, "
    "Stripe, Android, iPhone and Claude. Translate every text, even single words."
)
SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"key": {"type": "string"}, "text": {"type": "string"}},
                "required": ["key", "text"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}
_PLACE = re.compile(r"\{[a-zA-Z_][a-zA-Z0-9_]*\}")
_TAG = re.compile(r"</?[a-zA-Z][^>]*>")


def builtin_codes() -> list[str]:
    return sorted(f.stem for f in builtin_dir().glob("*.po"))


def custom_path(code: str):
    return extra_dir() / f"{code}.po"


def valid_code(code: str) -> bool:
    return bool(re.fullmatch(r"[a-z]{2,3}(-[a-z]{2,4})?", code or ""))


def _same_markup(source: str, text: str) -> bool:
    return sorted(_PLACE.findall(source)) == sorted(_PLACE.findall(text)) and sorted(_TAG.findall(source)) == sorted(_TAG.findall(text))


def _esc(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t")


def write_po(code: str, name: str, strings: dict[str, str]) -> None:
    english = _load_lang("en")
    path = custom_path(code)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ['msgid ""', 'msgstr ""', f'"Language: {code}\\n"', f'"X-Language-Name: {_esc(name)}\\n"', ""]
    for key in english:  # English order, so the file reads like en.po
        if key in strings:
            lines += [f'msgid "{_esc(key)}"', f'msgstr "{_esc(strings[key])}"', ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    reload(code)


def counts(code: str) -> tuple[int, int]:
    """(translated, total) against English."""
    english = _load_lang("en")
    mine = _load_lang(code) if code != "en" else english
    return sum(1 for k in english if mine.get(k)), len(english)


async def settings_of(db: AsyncSession) -> dict:
    section = await get_section(db, SECTION)
    section.setdefault("disabled", [])
    section.setdefault("custom", {})
    return section


async def save_settings(db: AsyncSession, section: dict) -> None:
    await set_section(db, SECTION, section)


async def _translate_batch(name: str, code: str, batch: dict[str, str]) -> dict[str, str]:
    payload = json.dumps([{"key": k, "text": v} for k, v in batch.items()], ensure_ascii=False)
    response = await ai.client().messages.create(
        model=ai.model(),
        max_tokens=16000,
        system=SYSTEM,
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": f"Target language: {name} ({code}).\n\n<texts>\n{payload}\n</texts>"}],
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"stopped: {response.stop_reason}")
    text = next((b.text for b in response.content if b.type == "text"), "")
    items = json.loads(text).get("items") or []
    out = {}
    for item in items:
        key, value = item.get("key"), (item.get("text") or "").strip()
        if key in batch and value and _same_markup(batch[key], value):
            out[key] = value
    return out


async def translate(code: str, name: str) -> None:
    """Translates what is still missing of `code` (all of it for a new language), saving after every batch."""
    english = _load_lang("en")
    done = dict(_load_lang(code)) if custom_path(code).exists() else {}
    missing = [k for k, v in english.items() if v and not done.get(k)]
    job = jobs[code] = {"done": len(english) - len(missing), "total": len(english), "state": "running", "error": ""}
    errors = 0
    try:
        await ai.refresh_if_stale()
        for i in range(0, len(missing), BATCH):
            batch = {k: english[k] for k in missing[i:i + BATCH]}
            try:
                done.update(await _translate_batch(name, code, batch))
            except Exception as e:  # a batch that fails is tried again on the next run
                errors += 1
                job["error"] = getattr(e, "message", None) or str(e)
                logger.warning("Translating %s: batch %s failed: %s", code, i // BATCH, job["error"])
                if errors >= 3 and len(done) == 0:
                    raise
            write_po(code, name, done)
            job["done"] = len(english) - len([k for k in english if english[k] and not done.get(k)])
            await asyncio.sleep(0)
        job["state"] = "done"
    except Exception as e:
        job["state"], job["error"] = "error", getattr(e, "message", None) or str(e)
        logger.exception("Translating %s failed", code)
