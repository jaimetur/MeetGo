# Changelog

All notable changes to this project will be documented in this file.

## Release: v0.2.0
### Release Date: 2026-11-23
#### ⚠️ Breaking Changes:
- Rooms and private chats become conversations: channels (by province, age range and interest), private groups and direct messages. Existing rooms, their messages and direct messages move over automatically on the first start; the old tables are kept untouched.
- The API changed: rooms (`/rooms/...`, `/ws/rooms/...`) and the old direct-message endpoints are replaced by `/conversations/...`, `/messages/...` and a single WebSocket at `/ws`, opened with a one-use ticket from `/realtime/ticket`.
- The database schema is now managed with Alembic migrations that run at startup.
- Removed the built-in `admin`/`admin` administration login; the first administrator now comes from `ADMIN_EMAIL`/`ADMIN_PASSWORD` and existing accounts are never changed at startup.
- Moved Docker secrets (`JWT_SECRET`, PostgreSQL and Redis passwords) to an untracked `.env.local`, stopped publishing Redis, removed the Docker socket and the reload mode from the production compose file, and refused the development JWT secret in production.
- Restricted the container logs endpoint to administrators, fixed its server error, and turned off the debug panel of the user interface.

#### 🌟 New Features:
- Private groups with invitation links, owners, administrators and moderators; members join, leave and can be removed, and the oldest member inherits a group whose owner leaves.
- Direct messages open at once between friends; with anybody else they start with a request, if that person accepts direct messages.
- Threads, replies quoting a message, reactions, editing (48 hours) and deleting messages, mentions with a mentions inbox, unread counts, read receipts in direct messages and groups, and "is typing" in real time.
- Image and file attachments (up to 10 MB) with thumbnails, served through signed links.
- Message search in your conversations, channel discovery for your zone, people search, pinned messages and pinned or muted conversations.
- Push notifications: Web Push for browsers and Firebase Cloud Messaging for the Android app, following each member's notification choice.
- Reports of messages and a moderation queue for administrators; channel moderators can silence, ban or remove people, and channels can have a slow mode.
- Subscriptions of 2.50 €/month or 25 €/year through Stripe (web) or Google Play (Android), with a 7-day trial; accounts created before subscriptions were enabled stay free.
- Launch campaign: the public code LANZAMIENTO (alias MEETGO50) gives one year free to the first 50 accounts. Administrators manage codes, free access and payment settings.
- New web app at `/app/`: conversation list with filters and unread and mention badges, channels, groups and direct messages, threads in a side panel, members panel with profile cards and moderation actions, replies, reactions, mentions with suggestions, emoji, attachments by button or paste, drafts, editing, search, a "new messages" divider and a jump-to-latest button, dark and light themes, and a phone layout with bottom navigation.
- Installable web app (PWA) with Web Push notifications, and a subscription page (card payment through Stripe, or Google Play inside the Android app) with promotional codes.
- Public landing page at `/` with the launch campaign counter, pricing, downloads and FAQ, plus draft privacy and terms pages.
- Android app (`android/`): the web app in a native shell with push notifications (Firebase Cloud Messaging) grouped by conversation with quick reply and mark as read, Google Play Billing, App Links for `https://meetgo.app/app/c/...`, sharing text and images into MeetGo, camera in the file picker, downloads, and first-run server and offline screens. GitHub Actions builds and signs the APK and AAB and publishes them as the `android-latest` pre-release; `tools/deploy-android.sh` copies the APK to the server, which serves it at `/downloads/android.apk`.
- Administration: plan column and free-access control for users, a moderation queue for reports, subscription, Stripe, Google Play and Firebase settings, and promotional codes.
- Automatic emails, like BodyLens, with a shared layout in each person's language: a summary of unread mentions, replies and messages (after a delay, never while connected, at most once every few hours), friend and direct-message requests, being added to a group, new reports for administrators, moderation notices and reminders before free access ends. Each person chooses them in Account → Notifications, every email has a link to stop it, and administrators can switch them off or tune the delays in Settings.
- The sign-in screen can send the confirmation email again, and a notice goes out when the password changes.

#### 🚀 Enhancements:
- All the branding images (icons, logos and the social sharing image) live in `assets/branding/` at the repository root, as in BodyLens; the web sites keep serving them at the same addresses.
- While subscriptions are off in the administration, the app is free: the web app, the sign-up form and the landing page hide plans, prices, codes and the launch campaign, and no plan reminders are sent. Switching subscriptions on shows them again.
- Split the backend into routers and services, with one shared Redis connection, real-time events fanned out through Redis for several processes, and presence kept in Redis.
- The web sites are built with Vite and served by nginx in production instead of the Vite development server.
- Removed the prefilled `admin`/`admin` credentials from the administration sign-in form and added the administration texts that were missing from the translations.
- The web app behaves like a native app on the iPhone and other phones: no zoom, no bounce at the start or end of lists and pages, 16 px fields, the screen fitted to the visible area with the keyboard open, room for the notch and the home bar in panels, sheets and dialogs, larger touch targets and the bottom tab bar on every main screen.
- New phone look: a frosted bottom tab bar with the current tab lit, conversations as bubbles (yours on the right), date pills, a one-line composer with round buttons, a large title, and the brand colour on the new-chat button, the active filter and each channel.
- Account: change your province and correct your date of birth (once); your channels move to the new province and age range. On phones, swipe between the main tabs; the tab bar sits at the bottom edge.
- The sign-in screen has a link to the website (the logo and a "Home page" button), as in BodyLens; not in the Android app.

#### 🐛 Bug fixes:
- Fixed the empty band under the phone tab bar in Safari: the app fills the whole screen and only fits the visible area while the keyboard is open.
- Sign-up now checks that the email is a real address (name@domain.tld).
- Fixed the room WebSocket holding a database connection while idle, which hung the API with about 15 connected users.
- Fixed moderation deleting words that contain an insult (for example "reputación"), and detected international phone numbers.
- Fixed sign-in without a password for accounts that have none, server errors for under-age or malformed birth dates, crossed friend requests and deleting a channel in use.
- Fixed long-pressing a message on a phone: the actions sheet closed as soon as the finger lifted, and in threads it did not open at all.
- Fixed the extra margins around the Channels, People, Mentions and Account screens, which on the iPhone also left them under the status bar.
- Sent emails in the background, serialized API dates as UTC with a `Z`, capped history pages, limited message length, reused one Redis connection and fixed the chat reconnection.

#### 📚 Documentation:
- Moved the tests to `tests/` at the repository root, one folder per module (as in BodyLens), run with `pytest` from the root.
- Added backend tests (`app/tests`) and how to run them.
- Rewrote the README: features, deployment behind a reverse proxy, and how to turn on payments and push notifications.
- Added `docs/ANDROID.md`: signing key, GitHub secrets, Firebase, Google Play subscription and App Links setup. `tools/CreateUpdateRelease.py` now also updates the Android version.

---

## Release: v0.1.0
### Release Date: 2026-09-10
- Added `tools/CreateUpdateRelease.py` and its PyCharm run configuration to update the current release or create, commit and push a new release branch.
- Added an iOS home-screen icon with the MeetGo navigation arrow, served from `web/assets`.
- Added separate PyCharm entry points for the user and administration interfaces.
- Added cross-platform local setup instructions for macOS, Linux, and Windows.
- Added local Vite support for the shared translation resources.
- Added the missing `greenlet` backend dependency for SQLAlchemy async startup.
- Removed duplicate registration phone fields that caused Vite warnings.
- Fixed backend startup by pinning bcrypt and aligning age range enum values.
- Added startup migration to extend Postgres age range enum with new values.
- Removed backend reload mode from compose to avoid dead listener on startup.
- Reworked admin UI: form-based settings editor, simplified channels with auto-slug, and user selector dropdown.
- Added admin UI error/validation messages for user/channel creation.
- Fixed register form defaults and surfaced API errors to the UI.
- Hid register form behind a "Nuevo Usuario" toggle in the login panel.
- Added success banner on account creation and clearer register feedback.
- Relaxed backend CORS to fix browser registration requests.
- Added legacy-prefixed age range handling to unblock registration on old data.
- Fixed admin user deletion by cleaning related records before removing users.
- Fixed admin user deletion crash by importing RoomDiscipline.
- Colored service logs by severity with correct [ERROR]/[WARNING]/[DEBUG] tags.
- Added delete confirmation and red delete button in admin users.
- Added user-facing login error message when backend rejects login.
- Added SMTP test email button in admin settings.
- Added admin action to resend verification email.
- Switched login to email-based authentication and normalized stored emails.
- Added interest loading error/ retry UI.
- Moved register phone field after name and split online summary into two lines.
- Updated phone prefix selector to show country flag and name with prefix.
- Cleared rooms and closed chat sockets on logout.
- Added country flag labels for phone prefix dropdowns.
- Auto-load rooms on login, removed "Cargar mis salas", and simplified panel toggle labels.
- Moved room location/age into rooms panel and simplified tips.
- Removed room name from header and reduced panel heights for mobile.
- Moved panel toggle buttons under online stats and moved logout next to profile tab.
- Made panel toggle buttons compact and increased logo size.
- Stored room messages per-room to avoid cross-room mixing.
- Increased logo size and forced left alignment for panel toggles under logo.
- Reduced heights for user panel, rooms panel, and chat container.
- Stacked brand text and buttons under the logo.
- Cropped logo SVG viewBox to reduce vertical whitespace.
- Moved active room details into header title while keeping the slogan.
- Reduced logo size to match new rectangular asset.
- Reduced logo size by another 10%.
- Slightly increased panel toggle button size.
- Increased panel toggle button size.
- Increased panel toggle button size further.
- Reduced rooms panel height slightly more than chat container.
- Moved logout button next to panel toggles under the logo.
- Styled logout button as red.
- Strengthened logout button red color.
- Reduced rooms panel height and added scroll for rooms list over 5 items.
- Moved "Abandonar Sala" under users button and styled it red.
- Reduced user and room panel heights to ~70% of previous size.
- Removed fixed main/chat heights and constrained message list to reduce blank space.
- Increased chat message max height to restore panel size.
- Increased panel minimum heights to restore overall layout.
- Stretched rooms and chat panels to fill their container height.
- Ensured rooms and chat panels stretch to full grid height.
- Expanded panels to fill container height and removed artificial message height cap.
- Reduced chat panel height to about half via messages max-height.
- Restored chat panel to full height by removing max-height limit.
- Capped rooms panel height.
- Moved rooms actions above the rooms list.
- Ensured rooms list scrolls independently so action buttons stay fixed.
- Increased rooms panel max height.
- Increased rooms panel max height a bit more.
- Removed rooms panel scroll to let list expand while space allows.
- Increased logo size and left-aligned panel toggles.
- Defaulted DM opt-in on register and removed the checkbox from registration UI.
- Renamed user panel toggle labels and added active room name above tips.
- Added backend room join endpoint to align frontend with /rooms/join.
- Removed backend Docker debug log endpoint to avoid missing docker module on startup.
- Added docker log timestamps for backend and web services via compose commands.
- Added restart + log helper script for development.
- Added .po-based frontend translations and loader (one file per language).
- Moved language selection into a Settings section and added settings save action.
- Updated room interest loading to use backend interests and restored emoji labels.
- Improved debug panel log formatting with timestamp + service tags.
- Fixed assorted frontend text and separator display issues.
- Added debug panel corner resize handles and enter-to-send chat behavior.
- Added backend websocket logging to help diagnose disconnects.
- Restored compose log streaming endpoint for the services debug panel.
- Added UI flow to leave a room with confirmation.
- Updated age range buckets to 18-30, 31-50, 51+ and tightened room access by age.
- Moved the leave-room control into the left panel with updated label.
- Added collapsible Settings and Edit Profile sections with country/city and profile fields.
- Enforced province/age change handling to leave rooms, with DOB change limited to once.
- Added new interest categories (cycling, motors, travel, sports, etc.).
- Added online user counts and users panel in rooms UI.
- Added sidebar hide toggle and improved dropdown styling and logo size.
- Moved room list into the rooms panel with its own hide toggle and presence summary.
- Added admin frontend scaffolding on port 5172 and admin APIs for users, settings, and channels.
- Added email verification and SMTP-based password reset flows.
- Switched user login to phone-only with required email verification on register.
