from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_ignore_empty=True, extra="ignore")

    # "dev" keeps local conveniences; "production" refuses insecure defaults.
    MEETGO_ENV: str = "dev"

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@db:5432/meetgo"
    DB_NULL_POOL: bool = False
    REDIS_URL: str = "redis://redis:6379/0"
    JWT_SECRET: str = DEV_JWT_SECRET
    JWT_ALG: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30

    # Comma-separated list of allowed browser origins. Empty in dev allows localhost origins.
    CORS_ORIGINS: str = ""

    # Initial administrator, created only when no administrator exists yet.
    ADMIN_EMAIL: str = "admin@local"
    ADMIN_PASSWORD: str = ""

    # Container logs for the administration panel (needs the Docker socket mounted).
    DEBUG_COMPOSE_LOGS: bool = False

    DEFAULT_MAX_MSGS_PER_MIN: int = 20
    DEFAULT_BLOCK_LINKS: bool = True
    DEFAULT_BLOCK_PHONE_NUMBERS: bool = True
    DEFAULT_CAPS_RATIO_THRESHOLD: float = 0.75
    DEFAULT_TOXIC_WORDS: str = "puta,puto,idiota,imbecil,subnormal,maricon,violacion"
    MAX_MESSAGE_CHARS: int = 4000

    # Uploaded attachments and downloadable files (Android APK) live here.
    DATA_DIR: str = "data"
    # Public address of this API, used in links sent outside the app (push, emails, Stripe).
    PUBLIC_API_BASE: str = "http://127.0.0.1:18000"

    # Android App Links: package name and SHA-256 fingerprints of the signing certificate(s).
    ANDROID_PACKAGE: str = "app.meetgo.android"
    ANDROID_CERT_SHA256: str = ""

    @property
    def is_production(self) -> bool:
        return self.MEETGO_ENV.lower() in ("prod", "production")

    def cors_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.CORS_ORIGINS.split(",") if o.strip()]

    def validate_for_runtime(self) -> None:
        if self.is_production and (not self.JWT_SECRET or self.JWT_SECRET == DEV_JWT_SECRET or len(self.JWT_SECRET) < 32):
            raise RuntimeError("Set JWT_SECRET to a random value of at least 32 characters in production.")


settings = Settings()
