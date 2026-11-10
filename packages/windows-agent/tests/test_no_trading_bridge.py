import importlib, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parents[1]

def test_no_mt5_reference_in_agent_sources():
    hits = [p.name for p in ROOT.rglob("*.py")
            if "tests" not in p.parts and re.search(r"mt5|metatrader", p.read_text(), re.I)]
    assert hits == []

def test_env_example_has_no_bridge_keys():
    assert "MT5" not in (ROOT / ".env.example").read_text()

def test_config_imports_without_bridge_key(monkeypatch):
    monkeypatch.delenv("MT5_BRIDGE_API_KEY", raising=False)
    monkeypatch.setenv("API_KEY", "x" * 32)
    monkeypatch.setenv("JWT_SECRET", "y" * 32)
    import config
    importlib.reload(config)  # must not exit
