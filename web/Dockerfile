# Production build of a MeetGo site, served by nginx.
# Build from the repository root (it needs lang/):
#   docker build -f web/Dockerfile --build-arg VITE_ROOT=web_user --build-arg VITE_API_BASE=https://api.meetgo.app .
FROM node:20-alpine AS build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY lang/ /src/lang/
ARG VITE_ROOT=web_user
ARG VITE_API_BASE=https://api.meetgo.app
RUN VITE_ROOT=$VITE_ROOT VITE_API_BASE=$VITE_API_BASE ./node_modules/.bin/vite build

FROM nginx:1.27-alpine
ARG VITE_ROOT=web_user
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/web/dist/${VITE_ROOT} /usr/share/nginx/html
EXPOSE 80
