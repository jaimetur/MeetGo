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

## Desarrollo local desde PyCharm (sin Docker)

1. Instala PostgreSQL 16 y Redis, crea la base de datos `meetgo`, e inicia ambos
   servicios. En macOS con Homebrew:

   ```bash
   brew install postgresql@16 redis
   brew services start postgresql@16
   brew services start redis
   createdb meetgo
   ```

2. Instala Node.js 20 o superior y las dependencias una vez:

   ```bash
   python -m pip install -e app
   cd web && npm install
   ```

3. En PyCharm, selecciona el intérprete Python del proyecto y crea una
   configuración de tipo **Python** con la raíz del proyecto como *Working
   directory*:

   - `MeetGo.py` inicia la API y la interfaz de usuario en
     `http://127.0.0.1:5173`.
   - `MeetGoAdmin.py` inicia la API y la interfaz de administración en
     `http://127.0.0.1:5174`.

   Detener la configuración detiene los procesos que haya iniciado.

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
