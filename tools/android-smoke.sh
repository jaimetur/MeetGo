#!/bin/sh
# Smoke test of the Android app in an emulator (run by .github/workflows/android.yml): installs the APK, opens it and
# keeps what tells whether it starts: smoke/result.txt (running or not), smoke/crash.txt (the crash, if any),
# smoke/log.txt (the app's log) and smoke/screen.png (what is on screen after 25 seconds).
set -u
APK=${1:-android/app/build/outputs/apk/release/app-release.apk}
mkdir -p smoke
adb install -r "$APK" > smoke/install.txt 2>&1
adb logcat -c
adb shell am start -W -n app.meetgo.android/.MainActivity > smoke/start.txt 2>&1
sleep 25
if adb shell pidof app.meetgo.android > /dev/null 2>&1; then echo "running" > smoke/result.txt; else echo "NOT RUNNING" > smoke/result.txt; fi
adb logcat -d -b crash > smoke/crash.txt 2>&1
adb logcat -d > smoke/full-log.txt 2>&1
grep -E "AndroidRuntime|FATAL|meetgo|chromium|WebView" smoke/full-log.txt | tail -300 > smoke/log.txt
adb exec-out screencap -p > smoke/screen.png 2>/dev/null
echo "== result: $(cat smoke/result.txt)"; cat smoke/start.txt; echo "== crash"; cat smoke/crash.txt
exit 0
