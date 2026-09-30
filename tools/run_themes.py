"""Run theme requests directly (no batch) and ingest them.

    python tools/run_themes.py "The Walls of Ba Sing Se" [--out data/commander_themes.test.jsonl]

Builds the request(s) with pipeline.themes, sends them, writes the raw model answers to
data/batch/theme_output.<slug>.json, then runs `pipeline.themes ingest`.
"""
import argparse, json, re, subprocess, sys
from pathlib import Path
import anthropic
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline.common import load_dotenv  # noqa: F401  (loads .env on import)

ap = argparse.ArgumentParser()
ap.add_argument("names", nargs="+")
ap.add_argument("--out", default="data/commander_themes.test.jsonl")
ap.add_argument("--tags", default="data/card_tags.jsonl")
args = ap.parse_args()

req_path = ROOT / "data/batch/theme_requests.test.jsonl"
subprocess.run([sys.executable, "-m", "pipeline.themes", "build", "--only", *args.names,
                "--tags", args.tags, "--requests", str(req_path)], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
client = anthropic.Anthropic(max_retries=3)
outs = []
for line in req_path.read_text().splitlines():
    req = json.loads(line)
    msg = client.messages.create(**req["params"])
    text = "".join(b.text for b in msg.content if b.type == "text")
    m = re.findall(r"```(?:json)?\s*(.*?)```", text, re.S)
    d = json.loads(m[-1] if m else text[text.find("{"):])
    d.setdefault("oracle_id", req["custom_id"].split("-", 1)[1])
    outs.append(d)
    print(req["custom_id"], msg.stop_reason, "in", msg.usage.input_tokens, "out", msg.usage.output_tokens, file=sys.stderr)
raw = ROOT / "data/batch/theme_output.test.json"
raw.write_text(json.dumps(outs, indent=1))
subprocess.run([sys.executable, "-m", "pipeline.themes", "ingest", str(raw), "--tags", args.tags,
                "--out", str(ROOT / args.out)], cwd=ROOT, check=True)
