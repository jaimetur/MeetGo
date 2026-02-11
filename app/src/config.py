from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_ignore_empty=True)

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@db:5432/meetgo"
    REDIS_URL: str = "redis://redis:6379/0"
    JWT_SECRET: str = "dev-secret-change-me"
    JWT_ALG: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30

    DEFAULT_MAX_MSGS_PER_MIN: int = 20
    DEFAULT_BLOCK_LINKS: bool = True
    DEFAULT_BLOCK_PHONE_NUMBERS: bool = True
    DEFAULT_CAPS_RATIO_THRESHOLD: float = 0.75
    DEFAULT_TOXIC_WORDS: str = "puta,puto,idiota,imbecil,subnormal,maricon,violacion"

settings = Settings()
