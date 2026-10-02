import pytest

from app.config import get_settings


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    """Every test gets its own empty data folder and no API key (unless a test sets one)."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    get_settings.cache_clear()
    yield tmp_path / "data"
    get_settings.cache_clear()


@pytest.fixture
def real_conn():
    from app.db import connect
    conn = connect("real")
    yield conn
    conn.close()


@pytest.fixture
def demo_conn():
    from app.db import connect
    conn = connect("demo")
    yield conn
    conn.close()
