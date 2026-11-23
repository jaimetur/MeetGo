#!/bin/sh
# Puts the latest APK of the Android app where the API serves it: /downloads/android.apk and /downloads/android.json,
# from <DATA_DIR>/downloads. It takes the rolling "android-latest" release that GitHub Actions rebuilds on every change
# in android/, after waiting for the build of the current commit (if there is one).
#   MEETGO_DOWNLOADS=/path/to/data/downloads tools/deploy-android.sh              # a folder on this computer
#   MEETGO_DOWNLOADS=user@host:/path/to/data/downloads tools/deploy-android.sh    # another computer (ssh and scp)
set -eu
DEST=${MEETGO_DOWNLOADS:?Set MEETGO_DOWNLOADS to the server folder <DATA_DIR>/downloads (a local folder or user@host:/path)}
command -v gh >/dev/null || { echo "gh not found: brew install gh && gh auth login" >&2; exit 1; }
cd "$(git rev-parse --show-toplevel)"
SHA=$(git rev-parse HEAD)
RID=""
for i in $(seq 1 30); do RID=$(gh run list --workflow android.yml --commit "$SHA" --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true); [ -n "$RID" ] && break; sleep 5; done
if [ -n "$RID" ]; then gh run watch "$RID" --exit-status >/dev/null || { echo "The Android build $RID failed." >&2; exit 1; }; fi
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
gh release download android-latest -p meetgo-android.apk -p android-build.txt -D "$TMP"
# android-build.txt: "build <run number> · <commit> · <version>"
BUILD=""; COMMIT=""; VERSION=""
read -r _ BUILD _ COMMIT _ VERSION < "$TMP/android-build.txt" || true
case "$BUILD" in ''|*[!0-9]*) echo "Unexpected android-build.txt: $(cat "$TMP/android-build.txt")" >&2; exit 1 ;; esac
printf '{"build": %s, "commit": "%s", "version": "%s"}\n' "$BUILD" "$COMMIT" "$VERSION" > "$TMP/android-build.json"
# the APK first and its description last, each written under a temporary name and renamed (never half a file)
case "$DEST" in
  /*|./*|../*) REMOTE="" ;;
  *:*) REMOTE=${DEST%%:*}; DEST=${DEST#*:} ;;
  *) REMOTE="" ;;
esac
for f in meetgo-android.apk android-build.json; do
  if [ -n "$REMOTE" ]; then
    ssh -o BatchMode=yes "$REMOTE" "mkdir -p '$DEST'"
    scp -q -o BatchMode=yes "$TMP/$f" "$REMOTE:$DEST/$f.tmp"
    ssh -o BatchMode=yes "$REMOTE" "chmod 644 '$DEST/$f.tmp' && mv -f '$DEST/$f.tmp' '$DEST/$f'"
  else
    mkdir -p "$DEST"
    cp "$TMP/$f" "$DEST/$f.tmp"
    chmod 644 "$DEST/$f.tmp"
    mv -f "$DEST/$f.tmp" "$DEST/$f"
  fi
done
echo "Android app in ${REMOTE:+$REMOTE:}$DEST: build $BUILD · $COMMIT · $VERSION"
