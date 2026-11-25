"""Send the store listing to Google Play in every language: its texts, its screenshots and its feature graphic.

Uses the Google Play Developer API (one "edit"); only what differs from the listing is sent (Google reviews every
change), and with nothing different the edit is dropped. For each language it creates or updates the listing with the texts in
assets/play-store/listings/<locale>.json (title, shortDescription, fullDescription), replaces the phone, 7" and 10"
tablet screenshots with those in assets/play-store/<device>/<lang>/ and the feature graphic with
docs/play-store/feature-1024x500-<es|en>.png, then commits. The Chromebook screenshots have no slot in the API: upload
them by hand. Needs the service account's JSON key (the PLAY_SERVICE_ACCOUNT_JSON secret, see docs/play-store/AUTO_UPLOAD.md)
and `pip install google-api-python-client google-auth`:

    PLAY_SERVICE_ACCOUNT_JSON="$(cat key.json)" python tools/play_listing.py [--langs es,en] [--dry-run]

The workflow .github/workflows/play-screenshots.yml runs it after taking the screenshots again.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "assets" / "play-store"
LISTINGS = SHOTS / "listings"
FEATURE = str(ROOT / "docs" / "play-store" / "feature-1024x500-{}.png")
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
    texts = {}
    for lang in langs:
        f = LISTINGS / f"{LANGS[lang]}.json"
        if f.exists():
            t = json.loads(f.read_text(encoding="utf-8"))
            assert len(t["title"]) <= 30 and len(t["shortDescription"]) <= 80 and len(t["fullDescription"]) <= 4000, f
            texts[lang] = t
    if args.dry_run:
        for lang in langs:
            print(f"{LANGS[lang]:6} texts: {'yes' if lang in texts else 'NO'}")
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

    current = {x["language"]: x for x in edits.listings().list(packageName=PACKAGE, editId=edit).execute().get("listings", [])}
    changes = 0
    # the texts first: updating a language that the listing does not have yet adds it
    for lang, t in texts.items():
        code = LANGS[lang]
        body = {"language": code, "title": t["title"], "shortDescription": t["shortDescription"], "fullDescription": t["fullDescription"]}
        old = current.get(code) or {}
        if all(old.get(k) == v for k, v in body.items()):
            continue
        edits.listings().update(packageName=PACKAGE, editId=edit, language=code, body=body).execute()
        have.add(code)
        changes += 1
        print(f"{code:6} texts")

    def same(code: str, kind: str, files: list) -> bool:
        """The listing already has exactly these images, in this order (Play gives each one's sha256)."""
        listed = images.list(packageName=PACKAGE, editId=edit, language=code, imageType=kind).execute().get("images", [])
        return [i.get("sha256") for i in listed] == [hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in files]

    sent = 0
    images = edits.images()
    for (lang, kind), files in plan.items():
        code = LANGS[lang]
        if code not in have:
            print(f"{code}: no texts in {LISTINGS.relative_to(ROOT)} and not in the listing yet; skipped")
            continue
        if not files or same(code, kind, files):
            continue
        changes += 1
        images.deleteall(packageName=PACKAGE, editId=edit, language=code, imageType=kind).execute()
        for f in files:
            images.upload(packageName=PACKAGE, editId=edit, language=code, imageType=kind,
                          media_body=MediaFileUpload(str(f), mimetype="image/jpeg")).execute()
        sent += len(files)
        print(f"{code:6} {kind:22} {len(files)} images")
    for lang in langs:
        code, graphic = LANGS[lang], Path(FEATURE.format("es" if lang == "es" else "en"))
        if code in have and graphic.exists() and not same(code, "featureGraphic", [graphic]):
            changes += 1
            images.deleteall(packageName=PACKAGE, editId=edit, language=code, imageType="featureGraphic").execute()
            images.upload(packageName=PACKAGE, editId=edit, language=code, imageType="featureGraphic",
                          media_body=MediaFileUpload(str(graphic), mimetype="image/png")).execute()
    if not changes:
        edits.delete(packageName=PACKAGE, editId=edit).execute()
        print("The Play listing already has these texts and images: nothing sent.")
        return 0
    edits.commit(packageName=PACKAGE, editId=edit).execute()
    print(f"Sent {changes} changes ({sent} screenshots) to the Play listing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
