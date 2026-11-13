"""Regenerate bounded independent WKW fixtures with the native wkw reference library.
Run: UV_CACHE_DIR=/tmp/wk-rust-reader-uv uv run --with wkw==1.1.24 python backend-rust/tools/generate_wkw_fixtures.py
"""
from pathlib import Path
import importlib.metadata
import json
import numpy as np
import wkw

root = Path(__file__).resolve().parents[1] / "datastore/tests/fixtures/wkw"
root.mkdir(parents=True, exist_ok=True)
c, x, y, z = np.indices((3, 16, 8, 8))
values = np.asarray(c + 3*x + 11*y + 37*z, dtype=np.uint8, order="F")
for kind, name in [(1, "raw"), (2, "lz4"), (3, "lz4hc")]:
    target = root / name
    target.mkdir(exist_ok=True)
    header = wkw.Header(np.uint8, num_channels=3, block_len=4, file_len=2, block_type=kind)
    with wkw.Dataset.create(str(target), header) as dataset:
        dataset.write((0, 0, 0), values)
        (target / "expected.bin").write_bytes(dataset.read((3, 2, 1), (10, 5, 6)).tobytes(order="F"))
(root / "oracle.json").write_text(json.dumps({"generator": "native wkw", "version": importlib.metadata.version("wkw"), "offset": [3,2,1], "shape": [10,5,6], "channels": 3}, indent=2) + "\n")
