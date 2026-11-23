#!/bin/sh
# Creates the signing key of the MeetGo Android app (the "upload key" of Google Play) and stores it in the GitHub
# secrets the Android workflow uses. Run it ONCE, yourself, on your computer: keep the .jks file and its password in a
# safe place (a password manager); every version of the app must be signed with this same key.
#   tools/android-keystore.sh [path/to/meetgo-upload.jks]
set -eu
KS=${1:-"$HOME/meetgo-upload.jks"}
ALIAS=meetgo
command -v keytool >/dev/null || { echo "keytool not found: install a JDK (brew install openjdk@17)."; exit 1; }
command -v gh >/dev/null || { echo "gh not found: brew install gh && gh auth login"; exit 1; }
if [ -e "$KS" ]; then echo "$KS already exists: not overwritten."; else
  printf "Password for the new key (at least 6 characters): "; stty -echo; read -r PW; stty echo; echo
  keytool -genkeypair -v -keystore "$KS" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
    -storepass "$PW" -keypass "$PW" -dname "CN=MeetGo"
fi
[ -n "${PW:-}" ] || { printf "Password of %s: " "$KS"; stty -echo; read -r PW; stty echo; echo; }
cd "$(git rev-parse --show-toplevel)"
base64 < "$KS" | tr -d '\n' | gh secret set ANDROID_KEYSTORE_B64
printf %s "$PW" | gh secret set ANDROID_KEYSTORE_PASSWORD
printf %s "$ALIAS" | gh secret set ANDROID_KEY_ALIAS
printf %s "$PW" | gh secret set ANDROID_KEY_PASSWORD
echo "Done: the next build of the app is signed with $KS. Keep that file and its password safe."
# App Links (https://meetgo.app/app/c/... opening in the app) need the certificate's fingerprint on the server
SHA=$(keytool -J-Duser.language=en -list -v -keystore "$KS" -alias "$ALIAS" -storepass "$PW" | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' | head -n 1)
echo
echo "SHA-256 fingerprint of the key: $SHA"
echo "Put it in ANDROID_CERT_SHA256 in the server's .env.local (the API serves it in /.well-known/assetlinks.json)."
echo "If Google Play signs the app (Play App Signing), add Play's app signing key fingerprint too, comma-separated"
echo "(Play Console → Test and release → App integrity → App signing)."
