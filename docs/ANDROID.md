# MeetGo Android app

The code is in `android/` (Kotlin). The app is a native shell around the web app: it shows `<server>/app/` full screen
in a WebView (so every deployment of the web app updates the app too) and adds what a web page cannot do by itself:

- **First run**: asks for the server (`https://meetgo.app` by default) and checks that `GET <server>/app/` answers 200.
  An offline screen offers to retry or to change the server.
- **Push notifications** with Firebase Cloud Messaging: one notification per conversation in Android's conversation
  style, with **Responder** (reply without opening the app) and **Marcar como leído**. Channels: *Mensajes directos*,
  *Grupos* and *Menciones en canales*. Nothing is shown for the conversation open on screen.
- **Google Play subscriptions** (product `meetgo`, base plans `monthly` and `yearly`, 7-day free-trial offer).
- **Sharing into the app**: text and images shared from other apps open `<server>/app/share`.
- **App Links**: `https://meetgo.app/app/c/...` (and `www.meetgo.app`) open in the app; so does a tapped notification.
- Downloads (DownloadManager), files made by the page (saved in Downloads and offered to share), the file picker with a
  "take a photo" option, the back button, and the system bars in the page's colour.

The user agent ends in ` MeetGoApp/<versionName>`, so the web app can tell it runs inside the app.

## Contract with the web app

The page talks to the app through `window.MeetGoNative` (only present inside the app):

| Method | What it does |
|---|---|
| `appVersion(): string` | The app's version (`0.2.123`). |
| `setSession(apiBase, token)` | After signing in **and on every load while signed in** (so an update of the app gets the session): the API origin (`https://api.meetgo.app`, https only) and the access token, used to reply and mark as read from the notifications. With an empty token (signing out) the app forgets both, removes its notifications and shows no more until the next sign-in. |
| `getPushToken(): string` | The FCM token, or `""` if push is unavailable (app built without Firebase) or not ready yet. The first call asks for the notification permission on Android 13+. When a token becomes available or changes, the app calls `window.mgNativePushToken(token)`. The page registers it with the API (`POST /devices` with `{"kind": "fcm", "token"}`). |
| `setActiveConversation(id)` | The conversation on screen (`0` = none): its notifications are removed and not shown while the app is in the foreground. |
| `setBadge(count)` | Unread count; used as the number of the next notifications (launchers that show numbers). Best effort. |
| `openNotificationSettings()` | Opens Android's notification settings of the app. |
| `changeServer()` | Back to the first-run screen (forgets the session). |
| `billingProducts(): string` | JSON `[{plan, price, trialDays}]` as Google Play offers them (`[]` while not available). |
| `subscribe(plan)` / `restorePurchase()` | Google Play's purchase screen / a purchase already made on this Google account. The result arrives as `window.mgPurchase({token, product})` or `window.mgPurchase({error, message?})` (`error`: `cancel`, `pending`, `failed`, `none`, `unavailable`); the page then sends the token to the API (`POST /billing/play/link`). |
| `takeShared(): string` | What was shared into the app, once: `{"text": "...", "files": [{"name", "mime", "base64"}]}` (at most 10 files of up to 10 MB), or `"{}"`. Call it when `/app/share` loads. |
| `saveFile(name, mime, base64)` | Saves a file the page made (blob/data downloads) in Downloads and offers to share it. |

The page also defines `window.mgBack()`, called by the back button: it returns `true` if it closed something (a
dialog, a thread, a conversation); otherwise the app goes back in history, or leaves.

The push messages are **data** messages (the API's `services/push.py`): `type="message"`, `conversation_id`,
`conversation_kind` (`dm`/`group`/`channel`), `message_id`, `thread_root_id`, `title`, `sender_name`, `body`, `url`
(`/app/c/12`) and `sent_at`. **Responder** posts `{"body", "client_id"}` to `<apiBase>/conversations/<id>/messages`
with `Authorization: Bearer <token>` (a 402 shows "Necesitas una suscripción activa"); **Marcar como leído** posts
`{"message_id"}` to `<apiBase>/conversations/<id>/read`.

## Building

GitHub Actions (`.github/workflows/android.yml`) builds every push to `main` or to a release branch (`X.Y.Z`) that
changes `android/`, and can be run by hand (*Run workflow*). It leaves `meetgo-android.apk` (to install directly),
`meetgo-android.aab` (for Google Play) and `android-build.txt` (build, commit and version) in the rolling pre-release
`android-latest`. Called from another workflow with `release_tag`, it attaches the APK and AAB to that release instead.

- `versionName` is the repository's release (`X.Y.Z`, the same as `pyproject.toml` and the CHANGELOG), written in
  `android/app/build.gradle.kts` by `tools/CreateUpdateRelease.py`; `versionCode` is the workflow's run number, which
  Google Play needs to grow with every upload. Play shows them as «0.2.0 (45)».
- Locally: open `android/` in Android Studio (JDK 17, Gradle 8.11.1; there is no Gradle wrapper in the repository), or
  run `gradle assembleDebug` in `android/`. Without `android/app/google-services.json` the app builds without push.

## One-time setup

### 1. Signing key

Run `tools/android-keystore.sh` once on your computer. It creates the upload key (`~/meetgo-upload.jks`, alias
`meetgo`), stores it in the repository secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, and prints its SHA-256 fingerprint (for App Links, step 5). Keep the
`.jks` and its password safe: every version must be signed with the same key. Without these secrets CI signs with a
throwaway debug key (fine to try the APK, not for Google Play, and App Links will not verify).

### 2. Firebase (push notifications)

1. In the [Firebase console](https://console.firebase.google.com) create a project (or reuse one) and add an Android
   app with the package name `app.meetgo.android`.
2. Download its `google-services.json`. For local builds put it in `android/app/google-services.json` (git-ignored, never
   commit it). For CI store it as a secret:
   `base64 < android/app/google-services.json | tr -d '\n' | gh secret set GOOGLE_SERVICES_JSON_B64`.
   Without that secret CI still builds the app, without push.
3. For the server to send notifications: Firebase console → Project settings → Service accounts → *Generate new
   private key*. Paste that JSON in MeetGo's administration → **Subscriptions** → **Firebase (notificaciones push)** →
   *Cuenta de servicio (JSON)*. It is stored encrypted; the project id is shown once saved.

### 3. Google Play: the app and the subscription

1. Create the app in the Play Console (package `app.meetgo.android`) and upload a first `meetgo-android.aab` to a
   testing track (Google Play only lets you create subscriptions once an app with the billing library has been uploaded).
2. *Monetize → Subscriptions*: create the subscription with product id **`meetgo`** and two auto-renewing base plans:
   **`monthly`** (1 month, 2,50 €) and **`yearly`** (1 year, 25 €). Activate them.
3. On each base plan add an offer with a **7-day free trial** (eligibility: new customers) and activate it. The app
   shows the trial when Google Play says the person can still have it.

### 4. Google Play: purchase verification

The API checks every purchase token with Google and acknowledges it:

1. In Google Cloud (the project linked to the Play Console, or any) create a service account and a JSON key for it.
2. In the Play Console → *Users and permissions*, invite the service account's email with *View financial data* and
   *Manage orders and subscriptions* for the app.
3. Paste the JSON key in MeetGo's administration → **Subscriptions** → **Google Play** → *Cuenta de servicio (JSON)*
   (package `app.meetgo.android`, product `meetgo`).

### 4b. Google Play: the reviewer's account

The app needs an account, so *App content → App access* asks for one for Google's reviewers:

1. Create it in MeetGo's administration → Users (for example `playreview@meetgo.app`, a province and a date of
   birth of an adult) with a password of your own, and put that address and password in *App access*.
2. Fill its zone with demo activity (demo people, communities with chat, board posts, plans with their plan chat):
   `docker compose … exec app python -m app.demo.play_review playreview@meetgo.app`. It can run again at any time.
   Demo people have addresses at `demo.meetgo.invalid`, no password and "Cuenta de demostración" in their bio; no
   email is ever sent to them.

### 5. App Links

Android only opens `https://meetgo.app/app/c/...` links in the app if both `https://meetgo.app` and
`https://www.meetgo.app` serve `/.well-known/assetlinks.json` with the app's certificate fingerprints.

- The API serves that file from `ANDROID_CERT_SHA256` (in the server's `.env.local`): the SHA-256 fingerprints,
  comma-separated, e.g. `AA:BB:...`. Put the upload key's (printed by `tools/android-keystore.sh`; it signs the APK
  installed from `/downloads/android.apk`) and, when Google Play signs the app, Play's *app signing key* fingerprint
  (Play Console → Test and release → App integrity → App signing).
- The API lives on its own origin, so the web server of `meetgo.app` and `www.meetgo.app` must answer
  `/.well-known/assetlinks.json` with the API's response (proxy that path to the API), without redirects.
- Check it with `adb shell pm get-app-links app.meetgo.android` after installing (the domains must be `verified`).

### 6. Publishing the APK on the server

`tools/deploy-android.sh` waits for the CI build of the current commit (if there is one), downloads the APK from
`android-latest` (it needs `gh` signed in) and copies `meetgo-android.apk` and `android-build.json`
(`{"build": N, "commit": "...", "version": "..."}`) to the server's `<DATA_DIR>/downloads`, each under a temporary name
and then renamed. The API serves them at `/downloads/android.apk` and `/downloads/android.json`.

```sh
MEETGO_DOWNLOADS=/path/to/data/downloads tools/deploy-android.sh             # a folder on this computer
MEETGO_DOWNLOADS=user@host:/path/to/data/downloads tools/deploy-android.sh   # another computer, with ssh and scp
```
