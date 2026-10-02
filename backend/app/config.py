"""Application settings, read from environment variables (or backend/.env).

Every setting has a safe default so the app runs without any configuration.
Only ANTHROPIC_API_KEY is needed for live AI features.
"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Where the SQLite databases and preserved raw uploads live.
    data_dir: Path = BACKEND_DIR / "data"

    # Frontend origin allowed to call the API from the browser.
    cors_origins: str = "http://localhost:3000"

    # --- Language model (optional) ---
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5"
    # Effort controls how much the model thinks (and costs): low | medium | high | xhigh | max
    ai_effort_report: str = "high"
    ai_effort_classify: str = "low"
    ai_timeout_seconds: float = 120.0
    ai_max_retries: int = 2
    ai_max_output_tokens: int = 16000
    # Server-side refusal fallback (lets the API retry on another model if a request is declined).
    ai_enable_fallbacks: bool = True

    # --- Request-size bounds (protect cost and context) ---
    ai_max_evidence_chars: int = 60_000      # total characters of evidence sent per report
    ai_max_excerpt_chars: int = 500           # per feedback/news excerpt
    ai_classify_batch_size: int = 20          # feedback items per classification request
    ai_classify_max_items: int = 200          # feedback items per classification run

    # --- Upload limits ---
    max_upload_bytes: int = 20 * 1024 * 1024

    @property
    def ai_configured(self) -> bool:
        return bool(self.anthropic_api_key and self.anthropic_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
