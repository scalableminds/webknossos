"""Snapshot one real N5 gzip block and compute bytes independently with NumPy/stdlib.
Run: uv run --with numpy python backend-rust/tools/generate_n5_fixture.py
"""
from pathlib import Path
import gzip, json, shutil, struct
import numpy as np

repo = Path(__file__).resolve().parents[2]
source = repo / "binaryData/sample_organization/n5-upload-fibsem123/s4"
target = repo / "backend-rust/datastore/tests/fixtures/n5/real_gzip"
(target / "0/0").mkdir(parents=True, exist_ok=True)
shutil.copyfile(source / "attributes.json", target / "attributes.json")
shutil.copyfile(source / "0/0/0", target / "0/0/0")
block = (source / "0/0/0").read_bytes()
mode, rank = struct.unpack_from(">hh", block)
shape = struct.unpack_from(">"+"i"*rank, block,4)
assert mode == 0 and rank == 3
raw = gzip.decompress(block[4+4*rank:])
values = np.frombuffer(raw, dtype=">u2").reshape(shape, order="F")
expected = values[1:9,2:10,3:11].astype("<u2").tobytes(order="F")
assert any(expected)
(target / "expected.bin").write_bytes(expected)
(target / "oracle.json").write_text(json.dumps({"source":str(source.relative_to(repo)), "decoder":"Python stdlib gzip + NumPy big-endian uint16 F reshape", "offset":[1,2,3], "shape":[8,8,8], "axisOrder":"xyz"}, indent=2)+"\n")
