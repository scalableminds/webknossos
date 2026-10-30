#!/usr/bin/env python3
"""Replay the checked-in annotation wire corpus against compiled ScalaPB classes.

Run after compiling the existing Scala datastore (sbt --client compile).
The ordinary Rust tests use the recorded fixture and do not require a JVM.
"""
import json
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
DATASTORE_TARGET = REPO / "webknossos-datastore/target"
CLASSES = DATASTORE_TARGET / "scala-3.8.3/classes"
DEPENDENCIES = DATASTORE_TARGET / "streams/compile/dependencyClasspath/_global/streams/export"


def main():
    if not CLASSES.is_dir() or not DEPENDENCIES.is_file():
        raise SystemExit("Compile the Scala datastore first: sbt --client compile")
    classpath = f"{CLASSES}:{DEPENDENCIES.read_text().strip()}"
    cases = json.loads((ROOT / "tests/fixtures/annotation_proto_scala.json").read_text())["cases"]
    oracle_input = "".join(f"{case['name']}\t{case['hex']}\n" for case in cases)
    with tempfile.TemporaryDirectory(prefix="wk-rust-proto-oracle-") as compiled:
        subprocess.run(
            ["javac", "-cp", classpath, "-d", compiled, str(ROOT / "tools/AnnotationProtoOracle.java")],
            cwd=REPO, check=True,
        )
        result = subprocess.run(
            ["java", "-cp", f"{compiled}:{classpath}", "AnnotationProtoOracle"],
            cwd=REPO, input=oracle_input, text=True, stdout=subprocess.PIPE, check=True,
        )
    expected = [f"{case['name']}\t{str(case['accepted']).lower()}" for case in cases]
    if result.stdout.splitlines() != expected:
        raise SystemExit("ScalaPB results differ from the recorded fixture:\n" + result.stdout)
    print(f"ScalaPB acceptance matches all {len(cases)} annotation fixtures.")


if __name__ == "__main__":
    main()
