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
- Geographic scope of the automatic communities, per interest in Administration → Communities: national (now the default), region or state, or province. Splitting gives each new zone a copy of the wider chat's history and moves its people there; joining makes one community with everyone, posts and requests, whose chat starts empty, while each zone's old chat can still be read for 30 days. Each interest shows its zones and age bands apart, can be for all ages, and suggests splitting when a community passes 500 people and joining when all stay under 10. Every community has an official language, by default its zone's.
- Categories of communities: chosen when creating a community (or a new one proposed, in «Other» until the administration approves it); Administration → Categories to create and rename them in the 10 languages, approve or reject proposals and move many communities at once. Communities has two switches: «New» (created in the last 30 days) and «Default» (only MeetGo's own).
- Covers of plans and events: besides an uploaded photo, one of 155 illustrations of a gallery made for MeetGo, each with its own place and subject drawn in colour (a football pitch with goals and ball, a padel court with glass walls, a pool with lanes, a polling station with a ballot box, a stage, a kitchen…), several for each built-in interest, Economy and Politics included, with their names in the 10 languages and a search by name, interest or category; those of the community's interest and category first (`tools/make_covers.py`, `tools/cover_catalog.py`).
- Administration → Business: a dashboard (users, subscriptions, MRR, Stripe revenue, trial conversion and cancellations, Google Play earnings and installs from its reports, direct APK downloads, the version on each Play track, last backup, mail and disk) by period, each figure with its source and age, and below it the settings of subscriptions, Stripe, Google Play (with its reports bucket), Firebase, Claude, mail tests and codes, each with «Test connection». Keys only show their last characters, mail passwords are never sent back, and the APK downloads are counted from now on.
- Administration → Interests: add, rename (in the 10 languages), hide or delete the interests people choose in their profile and for their communities.
- The emoji picker has every emoji, by category as in WhatsApp (smileys and people, animals, food, activities, travel, objects, symbols, flags), with your most used and recent ones on top; it stays open to add several, and puts them where the cursor is. Swipe sideways to go from one category to the next, or search emojis by their (English) name.
- Administration → Backups, as in DriveTest Analyzer: the stored backups, their size, the free disk space, the last and the next backup; «Back up now» (full: database and uploaded files; light: database only), «Restore» (choosing the parts, with an automatic backup first so it can be undone) with download and delete, and scheduled backups (hourly, every 4 hours, daily, weekly or monthly, light ones between weekly full ones) with retention by days, weeks and months. In the stack they go to its backups folder, visible on the NAS.
- The README has buttons to the website and the app.
- Interest names in every language (the built-in ones translated; editable in Administration), and the interest chats titled in the language of whoever reads them.
- Administration: groups of regions (autonomous communities, states…) can be created, renamed, deleted and assigned to each region.
- A name equal to its alias shows once («Lucy», not «Lucy (Lucy)»).
- Google Play store screenshots in all ten languages and for phone, 7" and 10" tablets and Chromebook, taken by tools/play_screenshots.py from a demo account with content in each language, in assets/play-store; a workflow takes them again on demand and attaches them to each release. The Android workflow uploads each build of a release branch to Play by itself once the PLAY_SERVICE_ACCOUNT_JSON secret exists (docs/play-store/AUTO_UPLOAD.md).
- Privacy policy and terms updated for the new data and features; «About MeetGo» shows © JTG Cloud Services.
- The tables of version 0.1 (rooms and direct messages), kept for safety after their data moved, are removed.
- A new password is typed twice (sign-up, «Forgot your password» and a person's card in Administration), so a typo cannot lock anyone out.
- The creator of a community can change, in «Edit», its geographic scope (its province, its autonomous community or the whole country) and its ages. Before saving they are told who would no longer fit; those people are expelled with a notice («expelled due to a change in the filter settings») and keep the earlier messages read only, with nothing new and without writing.
- Uploading an avatar photo opens a frame to choose the part that is kept: drag the photo, zoom with the slider, the mouse wheel or two fingers.
- Communities: an «Invite» button (owner and administrators) with the invitation link and a list to invite people registered in MeetGo (friends and people of the zone whose age fits); they get the invitation in People → Requests, with a notice and an email, and accept or decline it. The settings button now says «Edit».
- An age span can leave the maximum empty («From 30»): any age from the minimum fits. The age fields can be emptied while typing.
- Everyone gives a first name and surname(s) (asked once of whoever lacks them), and the display name becomes a username: one word, chosen by each person and unique. Chats, communities, lists, notifications and emails show the first name with the username in brackets, «Jaime (jaimetur)» (the surnames are in the person's card); @mentions use the username, and people can be found by either.
- Administration, a person's card: «Last activity» is when they last used the app (or «Now» when connected), «Visits» counts each time they came back after half an hour or more, and the time connected counts while the app is open. The sign-ins with the password are shown apart: the app keeps the session open, so they are few.
- When a new version is deployed, an open MeetGo shows a notice at the bottom to reload the page and apply the latest changes (checked every minute and when the app comes back); it sits above the tab bar and the message box, covering nothing.
- Communities for you suggests up to 6 communities, a full row on wide screens.
- Message info, as in WhatsApp: long-press one of your messages in a direct chat or group and tap Info to see when it reached each person and when they read it. The ticks now sit right after the time.
- The emoji picker, the message menu, the side panels (information, members, thread) and the pop-up windows close with a button or a swipe down. In a direct chat, Information shows the person's full card (friend, follow, block).
- A person's card shows "Request sent" (switched off) when you already asked them for friendship, instead of letting you ask again.
- Voice notes in chats: hold nothing, just tap the microphone when the message is empty, record up to 5 minutes and send (or discard); notes play in the chat with a seekable bar, and the chat list shows "🎤 Voice note". The Android app asks for the microphone (needs the new build).
- Where and for whom a community is now shows as tags (place, and its age range, ranges or own span) on community cards, the community page and the chat's info panel; the chat header keeps just the members, and your zone is only your place.
- Discover other zones at any level: a province (or state, region...), a group of them where the country has one (Spain's autonomous communities, Ireland's provinces, Japan's regions) or a whole country; over several provinces each community says which one it is in.
- On computers your own messages show on the right in a blue bubble, with your avatar beside it.
- Chat text a little bigger, and a text size in Settings for the whole app: Small, Normal (as designed) or Large, per device.
- Right-click a chat in the list for its menu (notifications, mute, pin, leave...) and the new "Delete chat": just for you, your history is emptied and it leaves your list until someone writes again.
- Communities: the switch is now All / My communities / New (the ones you are not in), with counts.
- The region field is named as each country calls it: province, state, region, department, county, prefecture, canton, district...
- "Channels" are called "chats" everywhere (app, emails, public pages) in every language.
- Age ranges are now 18-30, 31-60 and 61+: 31-50 communities become 31-60 and 51+ ones become 61+ (people aged 51 to 60 move to the 31-60 one).
- 36 countries with all their provinces, regions or states (all 52 Spanish provinces, including Ceuta and Melilla), shown in each person's language; an administrator's additions are kept.
- New communities: Cocina, Guitarra, Batería, Teclado and Bailes (new "Skills" category) and Baloncesto. Categories: "Socialise" (was "Go out and meet people") and "Education" for the language ones. "Salir de Fiesta" has a party icon.
- New communities: "Salir de Fiesta", "Hacer Amigos", "Aprender Inglés", "Aprender Alemán" and "Aprender Francés"; "Quedar para tomar algo" is now "Tomar algo". "Deporte" and "Deportes (general)" are now one community, "Deportes" (members, messages and plans move into it).
- New conversation: on phones the pencil is a round button above the tab bar, and its panel is clearer (direct message or group as two big choices, your friends or the search results with what each button will do, chosen people as chips).
- Your zone (province and age range) always in view as a tag at the top; tapping it lets you look at the communities of another country, province or age range (only your own zone can be joined), go back to your zone or change your province in your profile. Channels, chats and community pages no longer repeat the zone.
- Communities: themed areas of each zone with a board and a chat room. Anyone can create one, open to all, by request (an admin approves) or by invitation link; owners name admins and admins name moderators; the board can be open to members or read-only with only admins publishing. Changing province or age range leaves the old zone's communities and brings them back, as they were, on return.
- Community staff, and the administrators of MeetGo, expel someone with the Expel button next to each member, or by tapping their name in the community chat (take out: they can join again; expel: they cannot come back); the settings button next to each member also changes their role.
- The title of a community chat opens its community page.
- On phones the tab bar stays visible inside conversations too, with the message box just above it; opening the app with `?vp=1` shows what the phone reports about its screen, to adjust the layout.
- The app updates itself: when it comes back to the screen (and every few minutes) it checks whether a new version has been published and reloads, so the app installed on the phone no longer keeps an old version.
- Profile has its own Password section to change it (new password and repeat it).
- Installed on the iPhone, the app now takes the whole screen height (iOS reported it shorter), with the tab bar just above the home indicator and no empty strip below it.
- Phone tab bar: Home, Communities, Chats, Plans and People (with pending requests); the profile, settings, administration and signing out open from your avatar at the top. Bigger icons in a colour of their own, and a round ＋ at the side to publish (inside a community it publishes there). The strip of communities on Home is gone. On computers the menu reads Home, Communities, Chats, Plans, People.
- Community bots: every community, automatic or created, has the accounts @bot-admin and @bot-moderator. Linking someone to a bot (making them admin or moderator) gives them its powers: moderators ban for some hours or for good, admins also invite, accept requests and lift bans (only admins lift them). MeetGo's administrators are linked to both bots everywhere.
- The moderation bot applies each community's rules by itself: what breaks them (checked with Claude, plus insults, phone numbers and links) is removed and its author is banned for 6 hours, then 24 hours, then for good; the bot says it in the chat and tells the person. Needs `ANTHROPIC_API_KEY` (model in `MODERATION_MODEL`).
- The whole administration is inside the app for MeetGo's administrators (Profile → Administration): users, settings, channels, moderation, subscriptions, codes and the bot accounts, which they can use and leave with one tap; admin.meetgo.app takes you there.
- The Android app can be downloaded from the website again.
- Android app: the MeetGo icon (the paper plane) on the home screen and the start screen, and a smoke test in the build that opens the app in an emulator and keeps its log.
- Writing on the phone: the keyboard no longer covers the text on Android, the tab bar steps aside while writing so the message box sits right above the keyboard, the send button is bigger and next to the text, and the keyboard stays open after sending. On phones Enter adds a line and the button sends; on computers Enter sends and Shift+Enter adds a line.
- A community's chat on phones: one slim bar (back, name, rules, full-screen chat, settings) instead of the cover and the big header, without the repeated chat header, and only the messages and the message box while writing.
- Android app: opens MeetGo straight away (no server screen) and no longer loops between meetgo.app and www.meetgo.app, which kept it from loading; it is signed with the same key in every build.
- Android app ready for Google Play's current requirements: Play Billing 8 and target SDK 36; if the page's renderer stops, the app reloads instead of closing.
- Demo content for the Google Play reviewer's account (`python -m app.demo.play_review <email>`): demo people, communities with chat, board posts and plans in the reviewer's zone. No emails are sent to demo addresses.
- Community page: a cover with the hobby's icon scattered over its colours; tabs Board, Agenda (the coming meetups and events, day by day) and Members; the chat is a button (with unread count) that opens the community's real conversation, so there is no second, poorer chat and the header no longer jumps.
- Four more default communities: Conciertos, Música de los 80, Música Rock and Música Flamenca, with their icons (ticket, note, guitar).
- Ten colour themes besides the system's: six light (Light, Sand, Mint, Lavender, Peach, Sky) and four dark (Night, OLED black, Forest, Plum), chosen with swatches in Settings.
- Account tabs with an icon above a short name, so all of them fit on a phone; the avatar's My profile and Settings open their own tab, also from the account page.
- Profile photo: choose one from the gallery or the camera (Profile → Change photo); it is cropped square, kept small and shown everywhere, and can be removed. It replaces the old photo address field.
- Delete my account from the app (Settings → Delete my account, with the password) and a public page, /delete-account, with the steps and what is deleted (also for deleting only some data), as Google Play requires; administrators delete accounts the same way.
- Block people: from their card in a chat; neither of you can then message, follow or send requests to the other, you get no notifications of them and their messages are hidden from you; Settings lists the people you blocked.
- "Quedar para un café", "Quedar para una cerveza" and "Quedar para unas copas" are now one community, "Tomar algo": in each zone their members, messages, posts and requests move into it.
- Communities grouped by category (going out, sports, nature and travel, music and culture, motor, other), alphabetical in each; back from a community, the list is where you left it.
- In a chat, the message just sent (and the last one when the keyboard opens) stays fully in view.
- The privacy policy is no longer marked as a draft and links to the account deletion page.
- Google Play listing images in docs/play-store: icon, feature graphic (en/es) and screenshots for phone, tablet and Chromebook (en/es), taken from a demo account.
- Counts in the singular when there is one ("1 member", "1 plan"), in every language; the tab labels fit on 360 px phones; the agenda's dates no longer capitalise every word.
- Child safety: a public page with MeetGo's standards against child sexual abuse and exploitation (/child-safety, Spanish and English), as Google Play asks of social apps, and a "Child safety" reason when reporting a message or a post, shown first in the moderation queue.
- Fixed: while writing on a phone (or after tapping Reply) the page collapsed, so the message box and the reply seemed to vanish; and the app added to a Mac's Dock was taller than its window, hiding the message box and the end of lists.
- Community admins (and MeetGo's administrators) can empty a community's chat history from the chat's menu; everyone deletes their own messages, and staff those of others.
- Communities: one list by category with mine (Open, blue) and the rest (Join, green) together, and an "Only my communities" switch; the side column lists all my communities.
- People: sending a friend request says so and the button becomes "Request sent ✓" (also when searching again); "Ask to chat" replaces "Request", shows only for people who accept private messages, and becomes "Chat requested ✓".
- Computers: everything but the chat is bigger (more on large screens) and every page uses the width of the window: up to four communities per row and the board in two columns when there is room.
- The colour themes are chosen with tiny windows of the app in each theme (background, side panel, top bar, messages and button), and "As the system" shows light and dark side by side.
- Board of meetups, events, notices and threads: places and waiting list, sign-up open or with approval, comments for everyone, only for people going or off, a plan chat that people going join automatically, pin and close, reports to the moderation queue, and a reminder the day before.
- Full redesign of the web and phone app: Home board with filters (today, weekend, this week, meetups, events, notices), Plans (going, organising, past, with repeat), Publish, Chats and Profile; communities with board, chat and members; three columns on the desktop. Translated into the ten languages.
- Ten languages, translated from English: English, Spanish, Catalan, French, Italian, German, Portuguese, Dutch, Chinese and Japanese. The app, the landing page and the emails follow each person's language, the browser's language picks it the first time, and every `lang/<code>.po` added is a new language.
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
- The chat of a plan or event opens its plan from the header, and every plan chat (past ones too) goes under its community in Chats. The suggested communities take the whole width of the board when the six fit.
- Publishing or editing a post: Escape leaves it, and leaving with changes not published (Escape or the close button) asks first. The chats fold is called «Plans or Events (n)».
- Your communities: the latest active first, each with a «+» button to publish in it straight away.
- Plans and events are one kind of post with a type: one «Plan or Event» tab when publishing (Type: Plan / Event; an event adds its end and a tickets link), one «Plans or Events» filter on the board, and in Chats their chats go under their community's chat, indented, in one «Plans (n)» fold, each marked as plan or event (remembered on each device). The «meetup» kind is now called «plan» in every language.
- Play screenshots wait until the screen is still and only replace the stored ones that look different (more than 0.5 % of their pixels), and the store listing only receives the texts and images that differ from what Google has, so runs without visible changes neither commit nor send anything for review. The Android workflow's artifact upload moves to actions/upload-artifact v7 (Node 24).
- Drop-downs in windows (Discover another area and the rest) are as tall as the other fields.
- Community settings: the creator adds or removes co-administrators (optional) among the members; the window is wider on computers with each part in its own panel, and the interests are chosen in a window of their own.
- Communities: an «Admin» tab (the ones you created or co-administer, when there are any) apart from the joined ones, and «Not joined» instead of «New».
- New built-in interests: Economy and Politics, in the 10 languages and with their icons.
- The Google Play listing in the 10 languages, updated on its own: its texts (`assets/play-store/listings/`), screenshots and feature graphic per language (`tools/play_listing.py`).
- The landing's phone and computer screens follow the language chosen on the page, in the 10 languages.
- The landing's language selector shows a globe and the language's code, as in BodyLens.
- Google Play shows the repository's version (versionName = the release X.Y.Z, versionCode = the build number), every Android build of a release branch is uploaded to the track in the `PLAY_TRACK` variable (closed testing by default, production once Google allows it), and the Play screenshots are taken again on every relevant push to main or a release branch and sent to the store listing in each language (`tools/play_listing.py`).
- Communities show an icon of their hobby (hiking, cycling, reading, cinema, football, padel, beach, coffee, travel…) on compact cards and on their cover, also in the chat list. Rules support headings, lists, highlight boxes, bold, italic, underline, colours and emojis, with a formatting toolbar and a preview, and the information panel is easier to read on phones.
- Installed on the iPhone, the app fills the whole screen (iOS left a strip the height of the status bar empty at the bottom), and the tab bar sits just above the home indicator.
- Account page reorganised: a card with your photo, name, email and area and the sign-out button always in view, and tabs for profile (about you, your area, privacy and security), interests, notifications and settings.
- The app opens with a splash screen (icon, logo and tagline), the phone header shows the icon and the MeetGo logo over a glow in the brand colours, the active tab is lit with the brand gradient, and on the iPhone a notice explains how to install it on the home screen. In Safari the strip under the tab bar is painted like the bar.
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
- A message's menu opens above it when there is no room below (the last messages of a chat).
- Messages sent in a row show their own time too: on sent ones, always with the ticks at the bottom right.
- Windows: dragging one down to close it no longer leaves it see-through or half moved if the touch is lost (Android app), and their height works in WebViews without dvh.
- Windows (community settings and the rest) are never taller than the screen with the interface enlarged (computers, large text): their content scrolls and the buttons stay in view.
- iPhone: a long press on a message opened its menu but iOS then selected the menu's text and swallowed every tap; text can no longer be selected outside fields on touch screens (Copy is in the menu).
- Phones: replying to a message can be cancelled again; a long quoted message pushed the cancel button off the screen, and tapping it moved the composer away from the finger.
- The slogan "Meet People, Go Places!" is back on the sign-in screen, and Settings has an About MeetGo window with the icon, logo, slogan, app version, copyright and links to the website, terms and privacy.
- About MeetGo also opens from the avatar menu, from the app icon of the phone header (tap, long press or right click) and with a right click on the logo on computers.
- The administration is rebuilt inside the app's own design, one section per job: an Overview (people, online, active, messages, lively communities, upcoming plans, open reports, subscriptions, sign-ups of the last 30 days, where people are and what needs a look); Users (search, filters with counts, sorting, and a card per person with their activity and one-tap actions: administrator, verified email, block for 1/7/30 days or for good, free access, account details, delete); Moderation (the reported message with its author and the decision, including blocking the author for 7 days); Communities (grouped by category, renamed or removed in place); Codes (cards with use and expiry); Subscriptions (state of each service at a glance); Settings (folding topics with one save bar); and Bots.
- API: `GET /admin/stats`, `GET /admin/users/{id}/summary` and `POST /admin/users/{id}/ban`; the users list also gives `created_at`, `banned_until` and `online`.
- Administration → Settings → Claude: paste the Claude API key (stored encrypted, like the payment keys), pick the model and test the connection, with the steps to get a key. The moderation bot uses it without a restart; ANTHROPIC_API_KEY still works when no key is pasted.
- Administration → Settings → Languages: every language with how much of it is translated and a switch to show or hide it in the pickers; "Add a language" translates all of MeetGo with Claude in the background (progress shown, resumable), and the app loads added languages when it starts.
- Administration → Settings → Countries: a searchable list with flags; each country opens a card with its name, calling code, what its regions are called and its regions (rename, remove, add or paste several). An edited or deleted country is no longer undone when the server restarts. The age ranges are shown as a scale with why they are fixed.
- Administration → Communities: each interest community has a category, an icon and a colour (or automatic), and restrictions: active or not, and the age ranges it exists for. The app uses that look everywhere, and a restricted community is not created, listed or joinable outside its ages.
- Administration → Subscriptions → Firebase: step-by-step guide to get the service account JSON for Android push notifications.
- Dialogs that are taller than the screen scroll inside and keep their buttons visible.
- Phones: scrolling sideways through the suggested communities (or anything else that scrolls sideways) no longer swipes to another section.
- The zone tag at the top shows only the place. Every community shows where it is and for which ages ("Madrid · 31-60", or its own span) on its card, on its page and in its chat's header. The community cards' member and online counts are on one line again (a style clash put them one under the other).
- Looking at another zone keeps your own age range (worked out from your date of birth): only the place can change.
- Home suggests up to 5 communities of your zone that fit your profile's interests best. Communities made by people can choose up to 5 interests; each interest community comes with 1 to 5 related interests (administrators can change them).
- Interest communities get the settings of people's communities, set per interest in the administration and applied in every zone: fixed age ranges or a custom age span (then one community per province, joining the existing ones with their members and messages), who can join and join questions, who posts on the board and how long the chat keeps messages.
- Chats list: "Direct" comes right after "Unread", and the chosen tab is remembered on the device.
- Communities keep their chat for a limited time: interest communities one year; communities made by people one month by default, and their owner can choose 1, 2 or 3 days, 1 week, 1 or 3 or 6 months or 1 year. Older chat messages are deleted every few hours with their thread replies, reactions and files; the pinned message (and its thread), the board and plans stay. Existing communities made by people start at one year.
- Chats get WhatsApp ticks on every message I send: ✓ sent, ✓✓ delivered (it reached the other person's app) and blue ✓✓ read (in groups, by everyone). Settings → Privacy: read receipts can be switched off (then no blue ticks either way in private chats; groups always show them) and "last seen" can be shown to everyone, to friends or to nobody (nobody also hides the others'). Private chats show "last seen today at 21:30" under the name.
- Tapping a person's name or picture in a chat froze the app (the profile card broke a React rule); it opens their card again.
- Plans like Meetup: online and hybrid plans (the video call link only for people going); companions (+1, +2…) that take places; plans that repeat every week, every 2 weeks or every month (each date with its own list and chat, edited or deleted one by one or "this and the following"); "Add to calendar" (phone calendars and Google) and a personal calendar feed of my plans in Settings; duplicate any plan; a push 2 hours before; co-organisers; check-in of who came; private 1-5 ratings with a note the day after.
- Communities made by people can ask up to 3 questions to whoever asks to join (the answers show in the requests) and can be limited to an age span (for example 25-40), worked out from each person's date of birth; communities without a span and interest communities keep the fixed ranges. Staff see a Statistics tab: members and joins per week, activity, plans, real attendance and the average rating.
- The bar shown while an administrator uses a bot account is one line again on phones (it wrapped word by word into a bubble): the bot's name and the way back.
- Phones: the People tab has its colour (rose) again; selected, it no longer turned white on white.
- Fixed translations whose text ends in quotes losing the last quote.
- Fixed the empty band under the phone tab bar in Safari: the app fills the whole screen and only fits the visible area while the keyboard is open.
- Sign-up now checks that the email is a real address (name@domain.tld).
- Fixed the room WebSocket holding a database connection while idle, which hung the API with about 15 connected users.
- Fixed moderation deleting words that contain an insult (for example "reputación"), and detected international phone numbers.
- Fixed sign-in without a password for accounts that have none, server errors for under-age or malformed birth dates, crossed friend requests and deleting a channel in use.
- Fixed long-pressing a message on a phone: the actions sheet closed as soon as the finger lifted, and in threads it did not open at all.
- Fixed the extra margins around the Channels, People, Mentions and Account screens, which on the iPhone also left them under the status bar.
- Sent emails in the background, serialized API dates as UTC with a `Z`, capped history pages, limited message length, reused one Redis connection and fixed the chat reconnection.

#### 📚 Documentation:
- English is the source language: `lang/en.po` has every text (the landing page's too, now in the catalogs instead of in its script), other languages are translated from it and fall back to English, `lang/README.md` explains how to add a language and `tools/i18n_check.py` checks every translation against English.
- Reorganised the repository like BodyLens: `docker/` (Dockerfiles, nginx, compose, env and start scripts), `pyproject.toml` at the root, the API in `src/backend/app/` with one folder per module (auth, accounts, social, conversations, messaging, realtime, push, mail, billing, admin, public, and `core/`), the web sites in `src/frontend/`, translations kept in `lang/`.
- Moved the tests to `tests/` at the repository root, one folder per module (as in BodyLens), run with `pytest` from the root.
- Added backend tests (`app/tests`) and how to run them.
- Rewrote the README: features, deployment behind a reverse proxy, and how to turn on payments and push notifications.
- Added `docs/ANDROID.md`: signing key, GitHub secrets, Firebase, Google Play subscription and App Links setup. `tools/CreateUpdateRelease.py` now also updates the Android version.

#### 📱 Google Play (es-ES):
MeetGo se renueva por completo para conocer gente de tu zona.
• Comunidades de tu zona por aficiones, con tablón y chat
• Planes y quedadas con plazas y lista de espera
• Chats, grupos y mensajes directos con notas de voz, reacciones y confirmación de lectura
• Perfil con foto y 10 temas de color
• 10 idiomas
• Bloquear personas y denunciar mensajes

#### 📱 Google Play (en-US):
MeetGo has been rebuilt to meet people in your area.
• Communities of your area by hobby, with a board and a chat
• Plans and meetups with places and a waiting list
• Chats, groups and direct messages with voice notes, reactions and read receipts
• Profile photo and 10 colour themes
• 10 languages
• Block people and report messages

#### 📱 Google Play (ca):
MeetGo es renova del tot per conèixer gent de la teva zona.
• Comunitats de la teva zona per aficions, amb tauler i xat
• Plans i quedades amb places i llista d'espera
• Xats, grups i missatges directes amb notes de veu, reaccions i confirmació de lectura
• Perfil amb foto i 10 temes de color
• 10 idiomes
• Bloquejar persones i denunciar missatges

#### 📱 Google Play (de-DE):
MeetGo ist komplett neu, um Leute in deiner Gegend kennenzulernen.
• Communities deiner Gegend nach Hobbys, mit Pinnwand und Chat
• Pläne und Treffen mit Plätzen und Warteliste
• Chats, Gruppen und Direktnachrichten mit Sprachnachrichten, Reaktionen und Lesebestätigung
• Profilfoto und 10 Farbthemen
• 10 Sprachen
• Personen blockieren und Nachrichten melden

#### 📱 Google Play (fr-FR):
MeetGo fait peau neuve pour rencontrer des gens près de chez vous.
• Communautés de votre zone par loisir, avec un tableau et un chat
• Sorties et rencontres avec places et liste d'attente
• Chats, groupes et messages privés avec notes vocales, réactions et accusés de lecture
• Photo de profil et 10 thèmes de couleur
• 10 langues
• Bloquer des personnes et signaler des messages

#### 📱 Google Play (it-IT):
MeetGo si rinnova del tutto per conoscere persone della tua zona.
• Community della tua zona per hobby, con bacheca e chat
• Piani e incontri con posti e lista d'attesa
• Chat, gruppi e messaggi diretti con note vocali, reazioni e conferma di lettura
• Foto del profilo e 10 temi di colore
• 10 lingue
• Bloccare persone e segnalare messaggi

#### 📱 Google Play (ja-JP):
MeetGo を全面的に刷新しました。近くの人と出会えるアプリです。
• 趣味ごとの地域コミュニティ（掲示板とチャット付き）
• 定員とキャンセル待ちのあるプランや集まり
• チャット、グループ、ダイレクトメッセージ（ボイスメモ、リアクション、既読表示）
• プロフィール写真と10種類のカラーテーマ
• 10言語に対応
• ユーザーのブロックとメッセージの報告

#### 📱 Google Play (nl-NL):
MeetGo is helemaal vernieuwd om mensen in je buurt te leren kennen.
• Community's van je regio per hobby, met prikbord en chat
• Plannen en meetups met plaatsen en wachtlijst
• Chats, groepen en directe berichten met spraakberichten, reacties en leesbevestiging
• Profielfoto en 10 kleurthema's
• 10 talen
• Mensen blokkeren en berichten melden

#### 📱 Google Play (pt-PT):
O MeetGo foi totalmente renovado para conhecer pessoas da sua zona.
• Comunidades da sua zona por passatempo, com mural e chat
• Planos e encontros com lugares e lista de espera
• Chats, grupos e mensagens diretas com notas de voz, reações e confirmação de leitura
• Foto de perfil e 10 temas de cor
• 10 idiomas
• Bloquear pessoas e denunciar mensagens

#### 📱 Google Play (zh-CN):
MeetGo 全面焕新，帮你认识附近的人。
• 按兴趣划分的本地社区，带公告板和聊天
• 有名额和候补名单的计划与聚会
• 聊天、群组和私信，支持语音消息、表情回应和已读回执
• 个人头像和 10 种配色主题
• 支持 10 种语言
• 屏蔽他人和举报消息

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
