# MeetGo

Messaging for meeting people nearby: chat channels by province, age range and interest,
private groups and direct messages, on the web and in an Android app.

- **Backend** (`app/`): FastAPI, SQLAlchemy async, PostgreSQL (Alembic migrations run at
  startup), Redis (real-time fan-out, presence, rate limits).
- **Web** (`web/web_user/`): the public landing at `/` and the messaging app at `/app/`
  (React, TypeScript, Vite; installable as a PWA with Web Push).
- **Administration** (`web/web_admin/`): users, channels, moderation queue, subscriptions,
  promotional codes and settings.
- **Android** (`android/`): Kotlin shell around the web app with push notifications (FCM),
  quick reply, App Links, sharing into the app and Google Play Billing. See
  [docs/ANDROID.md](docs/ANDROID.md).

What the app does:
- Channels per zone (province + age range) and interest, joined from your interests, with
  automatic moderation (flood, links, phone numbers, shouting, insults), moderators, reports
  and slow mode.
- Private groups with invitation links and roles; direct messages between friends, or after
  a request with anybody who accepts them.
- Threads, replies, reactions, mentions, editing and deleting, attachments with thumbnails,
  search, unread counts, read receipts, typing indicators and presence, all in real time
  over one WebSocket.
- Subscriptions of 2.50 €/month or 25 €/year (Stripe on the web, Google Play in the app)
  with a 7-day trial, and the launch code LANZAMIENTO: one year free for the first 50
  accounts. Accounts created before subscriptions were switched on stay free.

## Quick start
Secrets are not stored in the repository. Copy the template and fill in random values:

```bash
cp .env.local.example .env.local
./dockers_run.sh
```

The first administrator is created only when none exists, with `ADMIN_EMAIL` and
`ADMIN_PASSWORD` from `.env.local`. If `ADMIN_PASSWORD` is empty, a random password is
printed once in the `app` logs.

- API (Swagger): http://localhost:18000/docs
- Landing: http://localhost:5173/ and the app: http://localhost:5173/app/
- Administration: http://localhost:5174

The web services build the sites with Vite and serve them with nginx (`web/Dockerfile`,
`web/nginx.conf`); `VITE_API_BASE` comes from `PUBLIC_API_BASE`. Put a TLS reverse proxy in
front: `meetgo.app` → `PORT_USER`, `admin.meetgo.app` → `PORT_ADMIN`, `api.meetgo.app` →
port 18000 (it must pass WebSocket upgrades for `/ws`). Uploaded files and the Android APK
live in the `meetgo_data` volume.

### Turning on subscriptions, payments and push notifications

Everything is set in the administration site. First, in **Ajustes**, set the public web
address to `https://meetgo.app`: email links and the return from Stripe use it. Then, in
the **Suscripciones** tab:
1. **Stripe** (web payments): paste the secret key (the two prices are created
   automatically) and the webhook signing secret. In the Stripe dashboard, add a webhook to
   the URL shown there with the events `checkout.session.completed` and
   `customer.subscription.*`.
2. **Google Play** (Android payments): package `app.meetgo.android`, subscription product
   `meetgo` with base plans `monthly` and `yearly`, and a service account with access to the
   Play Developer API.
3. **Firebase** (Android push): paste the service account JSON of the Firebase project.
   Browsers use Web Push, whose keys are created automatically.
4. Switch on **subscriptions** when payments work: from then on, new accounts need a plan,
   a free trial or a promotional code to write.

### Automatic emails

With outgoing mail set in **Ajustes** (SMTP or Gmail API, with a test button), MeetGo sends:
- **Account emails, always:** email confirmation (required to sign in; the sign-in screen can send it again),
  password reset and a notice when the password changes.
- **Notifications, if switched on** in **Ajustes → Emails automáticos** (on by default) and in each person's
  **Cuenta → Notificaciones**:
  - a summary of unread mentions and replies, and of unread messages in groups and direct messages;
  - friend and direct-message requests and their acceptance, and being added to a group;
  - new reports, for administrators;
  - moderation notices (silenced, banned, removed);
  - reminders 7 days and 1 day before free access ends, and when it has ended.
- Unread messages are never emailed one by one. Every 5 minutes the server sends one email per person with
  what they have not read after a delay (15 minutes by default), never while they are connected and at most
  once every few hours (3 by default). Both values are set in the administration.
- Every notification email has a link to stop that kind of email without signing in, plus the
  List-Unsubscribe headers. Emails go out in each person's language.

The **Códigos** tab manages promotional codes; LANZAMIENTO (alias MEETGO50) is created
with 50 places of one free year.

## Local development with PyCharm (without Docker)

All platforms need Python 3.11 or later, Node.js 20 or later, PostgreSQL 16,
and Redis (or a compatible Redis server). The launcher expects PostgreSQL on
port `5432`, Redis on port `6379`, and a database named `meetgo`.

### macOS

Install and start the services with Homebrew:

```bash
brew install postgresql@16 redis node
brew services start postgresql@16
brew services start redis
createdb meetgo
```

`MeetGo.py` and `MeetGoAdmin.py` also try to start the two Homebrew services
automatically when they are installed but stopped.

### Linux

On Ubuntu or Debian, install and start the services with:

```bash
sudo apt update
sudo apt install postgresql redis-server
sudo systemctl enable --now postgresql redis-server
sudo -u postgres createuser --pwprompt meetgo
sudo -u postgres createdb -O meetgo meetgo
```

Install Node.js 20 or later using your distribution's recommended method. Set
`DATABASE_URL` in your PyCharm run configuration with the credentials created
above:

```text
DATABASE_URL=postgresql+asyncpg://meetgo:your-password@127.0.0.1:5432/meetgo
```

### Windows

Install PostgreSQL 16 and Node.js 20 or later using their official installers.
Install a local Redis-compatible server, such as Memurai, or run Redis through
WSL2. Start both services from the Windows Services panel, then create the
database with pgAdmin or:

```powershell
psql -U postgres -c "CREATE DATABASE meetgo;"
```

Set the following environment variables in the PyCharm run configuration,
substituting your PostgreSQL password:

```text
DATABASE_URL=postgresql+asyncpg://postgres:your-password@127.0.0.1:5432/meetgo
REDIS_URL=redis://127.0.0.1:6379/0
```

### Install project dependencies

Install the project dependencies once:

```bash
python -m pip install -e app
cd web && npm install
```

### Configure PyCharm

In PyCharm, select the project Python interpreter and create a **Python** run
configuration with the project root as its *Working directory*:

- `MeetGo.py` starts the API and user interface at `http://127.0.0.1:5173`.
- `MeetGoAdmin.py` starts the API and administration interface at
  `http://127.0.0.1:5174`.

Stopping the run configuration stops the processes it started. Locally the first
administrator is `admin@local` with password `admin`. The user site opens the landing at
`/` and the app at `/app/`.

### Backend tests

See [app/tests/README.md](app/tests/README.md).

## Releases

Run `tools/CreateUpdateRelease.py` with the project interpreter (PyCharm run
configuration **CreateUpdateRelease**). The current version and release date
come from the first `## Release:` header of `CHANGELOG.md`.

- **Update Current Release** rewrites that header and sets the same version in
  `app/pyproject.toml`, `web/package.json` and `web/package-lock.json`.
- **Create New Release** creates a branch named after the new version (`X.Y.Z`),
  adds an empty release block on top of `CHANGELOG.md`, updates the same
  version files, then commits and pushes the branch to `origin`.

Without Tk it asks in the terminal. It also accepts
`--update VERSION DATE` and `--create VERSION DATE [--dirty commit|carry|discard]`.

## Docker commands
Pass both env files to every `docker compose` command, for example
`docker compose --env-file .env --env-file .env.local up -d`.

```bash
# Build and start in the foreground
docker compose up --build

# Start in the background
docker compose up -d

# Stop containers (keeps volumes/data)
docker compose stop

# Restart all services
docker compose restart

# Follow logs for all services
docker compose logs -f

# Follow logs for one service (example: app)
docker compose logs -f app

# Show status
docker compose ps

# Stop and remove containers (keeps volumes)
docker compose down

# Stop and remove containers + volumes (erases DB)
docker compose down -v
```

## Configuration
- `VITE_API_BASE` (build argument of the web services, from `PUBLIC_API_BASE`) is the API
  address the sites call. Without it, the sites use `:18000` on the same host during
  development and `https://api.meetgo.app` on `meetgo.app`.
- `CORS_ORIGINS` lists the browser origins allowed to call the API.

## Quick test flow
1. Open `/app/`, create an account (optionally with the code LANZAMIENTO) and confirm the
   email link (locally, set `email_verified` in the database if SMTP is not configured).
2. In **Cuenta**, choose some interests: you join their channels for your province and age.
3. Write in a channel, reply in a thread, react, mention someone with `@`.
4. Add a friend from their profile card and start a direct message or a group (pencil button).

## Notes
- Avatars are links (`avatar_url`); attachments are stored in `DATA_DIR/uploads`.
- Moderation can read messages on the server, so messages are not end-to-end encrypted.
- The legal pages (`/privacy.html`, `/terms.html`) are drafts pending legal review.
