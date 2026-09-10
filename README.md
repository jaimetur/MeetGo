# MeetGo -- Fullstack (Backend + Web)
Includes:
- FastAPI backend: rooms by province + age range + interest
- Room chat over WebSocket with auto-moderation (delete, strikes, mute, ban)
- Profiles with avatar + bio
- Context menu (right-click avatar in chat/feed) -> View profile / Friend request / Follow
- Simple Instagram-style feed (posts) based on people you follow
- Facebook-style friend requests (request + accept)

## Quick start
```bash
docker compose up --build
```

- Backend (Swagger): http://localhost:18000/docs
- Web (ui_user): http://localhost:5173
- Admin (ui_admin): http://localhost:5174

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

Stopping the run configuration stops the processes it started.

## Docker commands
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
- `VITE_API_BASE` in `docker-compose.yml` points to the backend URL used by the web app. Update it if your host IP changes.

## Quick test flow
1) Sign up in the web app (left column).
   - If you do not provide an Avatar URL, a DiceBear avatar is used.
2) Log in.
3) Rooms -> Load my rooms -> enter a room.
4) In chat: right-click someone's avatar -> menu.
5) Feed -> post, follow someone, and refresh the feed.

## Important notes (MVP)
- Photo uploads are not implemented: `avatar_url` is a URL. Typical setup uses S3/CDN.
- Security/CORS are open for simplicity.
- The feed is minimal text-only; can be extended to images, likes, comments, etc.
