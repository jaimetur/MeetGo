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
