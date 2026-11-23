#!/usr/bin/env python3
"""Checks every translation in lang/ against the source language (lang/en.po).

For each lang/<code>.po it lists the keys missing from it, the keys that are not in English, empty texts and
placeholders ({name}, {n}...) that differ from English. Exit code 1 if anything is missing or broken.

Usage: python3 tools/i18n_check.py [code ...]
"""

import re
import sys
from pathlib import Path

LANG_DIR = Path(__file__).resolve().parents[1] / "lang"
SOURCE = "en"
ENTRY = re.compile(r'^msgid "((?:[^"\\]|\\.)+)"\nmsgstr "((?:[^"\\]|\\.)*)"', re.M)
PLACEHOLDER = re.compile(r"\{\w+\}")


def catalog(code: str) -> dict[str, str]:
    return dict(ENTRY.findall((LANG_DIR / f"{code}.po").read_text(encoding="utf-8")))


def main(argv: list[str]) -> int:
    source = catalog(SOURCE)
    codes = argv or sorted(p.stem for p in LANG_DIR.glob("*.po") if p.stem != SOURCE)
    problems = 0
    print(f"{SOURCE}.po (source): {len(source)} texts")
    for code in codes:
        texts = catalog(code)
        missing = sorted(set(source) - set(texts))
        extra = sorted(set(texts) - set(source))
        empty = sorted(k for k, v in texts.items() if k in source and not v and source[k])
        placeholders = sorted(k for k, v in texts.items() if k in source and v
                              and sorted(PLACEHOLDER.findall(v)) != sorted(PLACEHOLDER.findall(source[k])))
        done = len(source) - len(missing) - len(empty)
        print(f"{code}.po: {done}/{len(source)} translated")
        for title, keys in (("missing", missing), ("not in English", extra), ("empty", empty), ("placeholders differ", placeholders)):
            if keys:
                print(f"  {title} ({len(keys)}): {', '.join(keys[:20])}{' …' if len(keys) > 20 else ''}")
        problems += len(missing) + len(empty) + len(placeholders)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
