# MeetGo: the API, the web site (landing and app) and the old administration address, in one container
# (app/serve.py listens on 8000, 8080 and 8081; app/web.py). Build from the repository root:
#   docker build -f docker/Dockerfile .

# The web site, built with Vite (it needs src/frontend/, lang/ and assets/branding/).
FROM node:20-alpine AS web
WORKDIR /srv/src/frontend
COPY src/frontend/package.json src/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src/frontend/ ./
COPY lang/ /srv/lang/
COPY assets/branding/ /srv/assets/branding/
ARG VITE_API_BASE=https://api.meetgo.app
RUN VITE_ROOT=web_user VITE_API_BASE=$VITE_API_BASE ./node_modules/.bin/vite build

FROM python:3.11-slim
WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/srv
RUN pip install --no-cache-dir -U pip
COPY pyproject.toml /srv/pyproject.toml
# Dependencies only (the code is copied below, and mounted from the stack folder on the NAS).
RUN python -c "import tomllib; print('\\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/req.txt \
    && pip install --no-cache-dir -r /tmp/req.txt
COPY src/backend/app /srv/app
COPY lang /srv/lang
# The web site of this image; a newer build in the stack folder's web/ (mounted at /srv/web-hot) wins.
COPY --from=web /srv/src/frontend/dist/web_user /srv/web
# Some hosts (Synology ACL shares) send the build context with mode 000: the files must be readable.
RUN chmod -R a+rX /srv/web
EXPOSE 8000 8080 8081
CMD ["python", "-m", "app.serve"]
