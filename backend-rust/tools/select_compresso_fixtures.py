"""Copy the checked-in selection from a regenerated full oracle corpus."""
import argparse
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--corpus", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--manifest", type=Path, required=True)
args = parser.parse_args()
cases = json.loads(args.manifest.read_text())
args.output.mkdir(parents=True, exist_ok=True)
for case in cases:
    for suffix in (".cpso", ".raw"):
        name = case["name"] + suffix
        shutil.copyfile(args.corpus / name, args.output / name)
(args.output / "cases.json").write_text(json.dumps(cases, indent=2) + "\n")
print(f"Selected {len(cases)} native/independent encoder cases")
