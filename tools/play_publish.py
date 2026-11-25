#!/usr/bin/env python3
"""Publishes MeetGo's Android app to Google Play with the Google Play Developer API, without the web console.

    PLAY_SERVICE_ACCOUNT_JSON="$(cat key.json)" python tools/play_publish.py bundle app.aab [--track alpha] [--name "0.2.0 (45)"] [--version 0.2.0]
    PLAY_SERVICE_ACCOUNT_JSON="$(cat key.json)" python tools/play_publish.py promote 0.2.0 [--from alpha] [--track production]
    python tools/play_publish.py notes 0.2.0        # the release notes Play would get (no key needed)

- bundle: uploads an Android App Bundle and releases it to a track (alpha, the closed test, by default), with --name
  as the release name and the notes of --version. android.yml does it on every build of a release branch (X.Y.Z).
- promote: puts the build of a version that is on a track (alpha by default; its release is named "X.Y.Z (N)") on
  another one (production by default), for every user, with the version's notes. release.yml does it on every push
  to main, to the PLAY_STABLE_TRACK variable's track: the build the testers had, without building it again.
- Release notes ("What's new") come from the version's block in CHANGELOG.md (release_notes()).

The store screenshots go with tools/play_listing.py. The service account (its JSON key in PLAY_SERVICE_ACCOUNT_JSON,
see docs/play-store/AUTO_UPLOAD.md) needs "Release apps to testing tracks", and "Release to production" for production.
--validate checks the changes and discards them.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "app.meetgo.android"
API = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}"
UPLOAD = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PACKAGE}"
CHANGELOG = ROOT / "CHANGELOG.md"
CHANGELOG_LANG = "en-US"  # the language CHANGELOG.md is written in
NOTES_MAX = 500  # Play's limit for the release notes of each language
USER_SECTIONS = ("🌟", "🚀", "🐛")  # sections of a changelog block that users notice: new, better, fixed


def release_notes(version: str) -> dict[str, str]:
    """Play's "What's new" for a version, by language, from its block in CHANGELOG.md.

    Its "#### 📱 Google Play (<language>):" sections as they are (one per language, e.g. "(es-ES)"); without them, the
    titles of its new features, enhancements and fixes, one per line, in the changelog's language. At most 500
    characters per language, as Play allows."""
    m = re.search(rf"^## Release: v{re.escape(version)}\s*$(.*?)(?=^---\s*$|^## |\Z)",
                  CHANGELOG.read_text(encoding="utf-8"), re.M | re.S)
    if not m:
        return {}
    sections = re.findall(r"^#### (.*?)\n(.*?)(?=^#### |\Z)", m.group(1), re.M | re.S)
    own = {}
    for head, body in sections:
        lang = re.match(r"📱 Google Play \(([\w-]+)\):?$", head.strip())
        if lang and body.strip():
            text = body.strip()
            own[lang.group(1)] = text if len(text) <= NOTES_MAX else text[:NOTES_MAX - 1].rstrip() + "…"
    if own:
        return own
    lines: list[str] = []
    for head, body in sections:
        if not head.startswith(USER_SECTIONS):
            continue
        for item in re.findall(r"^- (.+)$", body, re.M):
            bold = re.match(r"\*\*(.+?)\*\*", item)
            title = bold.group(1) if bold else re.split(r"(?<=[.:;])\s|\s\(", item, maxsplit=1)[0]
            title = re.sub(r"[*`]", "", title).strip().rstrip(".:;,")
            if len(title) > 120:
                title = title[:119].rstrip() + "…"
            if title and len("\n".join(lines + [f"• {title}"])) <= NOTES_MAX:
                lines.append(f"• {title}")
    return {CHANGELOG_LANG: "\n".join(lines)} if lines else {}


def session(key: str | None):
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account

    info = json.loads(Path(key).read_text() if key else os.environ.get("PLAY_SERVICE_ACCOUNT_JSON") or "null")
    if not info:
        sys.exit("No service account: set PLAY_SERVICE_ACCOUNT_JSON or pass --key.")
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/androidpublisher"])
    return AuthorizedSession(creds)


def ok(r):
    if r.status_code >= 400:
        sys.exit(f"Google Play: {r.status_code} {r.text[:600]}")
    return r.json() if r.content else {}


def finish(s, edit: str, validate: bool) -> None:
    if validate:
        ok(s.post(f"{API}/edits/{edit}:validate"))
        s.delete(f"{API}/edits/{edit}")
        print("Valid; nothing was changed.")
    else:
        ok(s.post(f"{API}/edits/{edit}:commit"))
        print("Sent to Google Play: Google reviews the version before it is shown.")


def releases(s, edit: str, track: str) -> list[dict]:
    """Releases of a track (none if the track has never had one)."""
    r = s.get(f"{API}/edits/{edit}/tracks/{track}")
    return [] if r.status_code == 404 else ok(r).get("releases", [])


def set_track(s, edit: str, track: str, release: dict, notes: dict[str, str]) -> None:
    """Make `release` the only one of the track, with the notes of the languages the listing has."""
    have = {x["language"] for x in ok(s.get(f"{API}/edits/{edit}/listings")).get("listings", [])}
    for lang in sorted(set(notes) - have):
        print(f"Release notes in {lang} skipped: the listing has no {lang} translation")
    release["releaseNotes"] = [{"language": k, "text": v} for k, v in sorted(notes.items()) if k in have]
    ok(s.put(f"{API}/edits/{edit}/tracks/{track}", json={"track": track, "releases": [release]}))


def bundle(s, a) -> None:
    edit = ok(s.post(f"{API}/edits"))["id"]
    with open(a.aab, "rb") as f:
        b = ok(s.post(f"{UPLOAD}/edits/{edit}/bundles", params={"uploadType": "media"}, data=f,
                      headers={"Content-Type": "application/octet-stream"}, timeout=600))
    code = b["versionCode"]
    release = {"versionCodes": [str(code)], "status": a.status, **({"name": a.name} if a.name else {})}
    set_track(s, edit, a.track, release, release_notes(a.version) if a.version else {})
    print(f"Version {code} → {a.track} ({a.status}).")
    finish(s, edit, a.validate)


def promote(s, a) -> None:
    edit = ok(s.post(f"{API}/edits"))["id"]
    found = [r for r in releases(s, edit, a.source) if r.get("name", "").startswith(f"{a.version} (") and r.get("versionCodes")]
    if not found:
        names = ", ".join(r.get("name", "?") for r in releases(s, edit, a.source)) or "nothing"
        sys.exit(f"Google Play: the {a.source} track has no {a.version} build (it has: {names}). Run the Android "
                 f"workflow on the {a.version} branch first, so that it reaches the {a.source} track.")
    rel = max(found, key=lambda r: max(int(c) for c in r["versionCodes"]))
    if any(r.get("versionCodes") == rel["versionCodes"] for r in releases(s, edit, a.track)):
        s.delete(f"{API}/edits/{edit}")
        print(f"{rel['name']} is already on the {a.track} track: nothing to do.")
        return
    set_track(s, edit, a.track, {"name": rel["name"], "versionCodes": rel["versionCodes"], "status": "completed"},
              release_notes(a.version))
    print(f"{rel['name']}: from the {a.source} track to the {a.track} track")
    finish(s, edit, a.validate)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--key", help="service account JSON key file (default: PLAY_SERVICE_ACCOUNT_JSON)")
    ap.add_argument("--validate", action="store_true", help="check the changes and discard them")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("bundle", help="upload an AAB and release it to a track")
    b.add_argument("aab")
    b.add_argument("--track", default="alpha", help="alpha (closed test, default), internal, beta, production")
    b.add_argument("--status", default="completed", choices=["completed", "draft"])
    b.add_argument("--name", default="", help='release name shown in Play Console (e.g. "0.2.0 (45)")')
    b.add_argument("--version", default="", help="X.Y.Z: its block in CHANGELOG.md gives the release notes")
    pr = sub.add_parser("promote", help="put a version's build of one track on another, with its release notes")
    pr.add_argument("version", help="X.Y.Z")
    pr.add_argument("--from", dest="source", default="alpha", help="track the build is on (default alpha)")
    pr.add_argument("--track", default="production", help="track to put it on (default production)")
    no = sub.add_parser("notes", help="print the release notes of a version, as Play would get them")
    no.add_argument("version", help="X.Y.Z")
    a = ap.parse_args()
    if a.cmd == "notes":
        for lang, text in release_notes(a.version).items():
            print(f"Release notes ({lang}, {len(text)} characters):\n{text}")
        return
    s = session(a.key)
    {"bundle": bundle, "promote": promote}[a.cmd](s, a)


if __name__ == "__main__":
    main()
