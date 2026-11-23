# MeetGo API (FastAPI). Build from the repository root:
#   docker build -f docker/Dockerfile .
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
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
