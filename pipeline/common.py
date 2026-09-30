"""Shared helpers: paths, vocab loading, JSON IO."""
from __future__ import annotations

import json
import os
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
VOCAB_PATH = ROOT / "vocab" / "tags.yaml"
CONFIG_PATH = ROOT / "config" / "pipeline.yaml"
PROMPTS = ROOT / "prompts"
DATA = ROOT / "data"

TYPAL_PREFIX = "typal:"


def load_dotenv(path: Path | None = None) -> None:
    """Read KEY=value lines from edh-tool/.env into the environment (without overriding
    variables that are already set). Keeps the API key out of code and out of git."""
    path = path or ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip().removeprefix("export ").strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_dotenv()


def load_yaml(path: Path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_vocab(path: Path = VOCAB_PATH) -> dict:
    v = load_yaml(path)
    ids = [t["id"] for t in v["tags"]]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise ValueError(f"duplicate tag ids in vocab: {sorted(dupes)}")
    for t in v["tags"]:
        if t["category"] not in v["categories"]:
            raise ValueError(f"tag {t['id']} has unknown category {t['category']}")
    v["by_id"] = {t["id"]: t for t in v["tags"]}
    return v


def load_config(path: Path = CONFIG_PATH) -> dict:
    return load_yaml(path)


def is_valid_tag(tag: str, vocab: dict, creature_types: set[str] | None = None) -> bool:
    if tag.startswith(TYPAL_PREFIX):
        t = tag[len(TYPAL_PREFIX):]
        return bool(t) and (creature_types is None or t in creature_types)
    return tag in vocab["by_id"]


def read_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, obj, indent: int | None = 1) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
        f.write("\n")


def read_jsonl(path: Path) -> list:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_jsonl(path: Path, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
