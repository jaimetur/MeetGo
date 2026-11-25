"""Send the store screenshots in assets/play-store/<device>/<lang>/ to the Google Play listing, in every language.

Uses the Google Play Developer API (one "edit": it replaces the phone, 7" and 10" tablet screenshots of each language
whose translation the listing already has, then commits). The Chromebook ones have no slot in the API: upload them by
hand. Needs the service account's JSON key (the PLAY_SERVICE_ACCOUNT_JSON secret, see docs/play-store/AUTO_UPLOAD.md)
and `pip install google-api-python-client google-auth`:

    PLAY_SERVICE_ACCOUNT_JSON="$(cat key.json)" python tools/play_listing.py [--langs es,en] [--dry-run]

The workflow .github/workflows/play-screenshots.yml runs it after taking the screenshots again.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "assets" / "play-store"
PACKAGE = "app.meetgo.android"
# our folder → Play's language code
LANGS = {"es": "es-ES", "en": "en-US", "ca": "ca", "de": "de-DE", "fr": "fr-FR", "it": "it-IT", "pt": "pt-PT",
         "nl": "nl-NL", "ja": "ja-JP", "zh": "zh-CN"}
# our folder → Play's image type (at most 8 each)
TYPES = {"phone": "phoneScreenshots", "tablet7": "sevenInchScreenshots", "tablet10": "tenInchScreenshots"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--langs", default=",".join(LANGS))
    ap.add_argument("--dry-run", action="store_true", help="say what would be sent, without connecting")
    args = ap.parse_args()
    langs = [lang for lang in args.langs.split(",") if lang in LANGS]

    plan = {(lang, kind): sorted((SHOTS / folder / lang).glob("*.jpg"))[:8]
            for lang in langs for folder, kind in TYPES.items()}
    if args.dry_run:
        for (lang, kind), files in plan.items():
            print(f"{LANGS[lang]:6} {kind:22} {len(files)} images")
        return 0

    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    key = os.environ.get("PLAY_SERVICE_ACCOUNT_JSON")
    if not key:
        print("No PLAY_SERVICE_ACCOUNT_JSON: nothing sent.")
        return 0
    creds = service_account.Credentials.from_service_account_info(
        json.loads(key), scopes=["https://www.googleapis.com/auth/androidpublisher"])
    edits = build("androidpublisher", "v3", credentials=creds, cache_discovery=False).edits()
    edit = edits.insert(packageName=PACKAGE, body={}).execute()["id"]
    have = {x["language"] for x in edits.listings().list(packageName=PACKAGE, editId=edit).execute().get("listings", [])}

    sent = 0
    for (lang, kind), files in plan.items():
        code = LANGS[lang]
        if code not in have:
            print(f"{code}: the listing has no translation in this language yet (Play Console → Manage translations); skipped")
            continue
        if not files:
            continue
        images = edits.images()
        images.deleteall(packageName=PACKAGE, editId=edit, language=code, imageType=kind).execute()
        for f in files:
            images.upload(packageName=PACKAGE, editId=edit, language=code, imageType=kind,
                          media_body=MediaFileUpload(str(f), mimetype="image/jpeg")).execute()
        sent += len(files)
        print(f"{code:6} {kind:22} {len(files)} images")
    edits.commit(packageName=PACKAGE, editId=edit).execute()
    print(f"Sent {sent} screenshots to the Play listing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
