# MeetGo — Fullstack (Backend + Web)
Incluye:
- Backend FastAPI: salas por provincia + rango edad + interés
- Chat de sala por WebSocket con moderación automática (borra, strikes, mute, ban)
- Perfiles con avatar + bio
- Menú contextual (click derecho en avatar en chat/feed) -> Ver perfil / Solicitud de amistad / Seguir
- Feed simple estilo Instagram (posts) basado en gente a la que sigues
- Friend requests estilo Facebook (solicitud + aceptar)

## Arranque
```bash
docker compose up --build
```

- Backend: http://localhost:8000/docs
- Web: http://localhost:5173

## Cómo probar rápido
1) Regístrate en la web (columna izquierda).
   - Si no pones Avatar URL, se usa un avatar automático (DiceBear).
2) Login.
3) Salas -> Cargar mis salas -> entra en una sala.
4) En el chat: click derecho sobre el avatar de alguien -> menú.
5) Feed -> publica un post, sigue a alguien y refresca el feed.

## Notas importantes (MVP)
- La subida de fotos no está implementada: `avatar_url` es una URL. Lo normal es añadir S3/CDN.
- Seguridad/CORS están abiertos por simplicidad.
- El feed es minimalista (texto). Se puede extender a imágenes, likes, comments, etc.
