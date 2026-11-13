"""Generate independent HDF5 fixtures/oracles (h5py 3.15.1, numpy 2.3.4).

Run from repository root:
uv run --with h5py==3.15.1 --with numpy==2.3.4 python backend-rust/tools/generate_segment_index_fixtures.py
No Python or libhdf5 dependency is used by the datastore runtime.
"""
from pathlib import Path
import json
import shutil
import h5py
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "backend-rust/datastore/tests/fixtures/segment_index"
OUT.mkdir(parents=True, exist_ok=True)
offsets = [0, 2, 4]
buckets = [[2, 0, 2], [4, 2, 3], [3, 3, 4], [2**64 - 1, 4, 5]]
positions = [[0, 0, 0], [1, 0, 0], [2, 3, 0], [5, 5, 5], [32767, 32768, 65535]]
for name, version, endian, compressed in [
    ("contiguous", "earliest", "<", False),
    ("chunked", "latest", ">", True),
    ("chunked_v1", "earliest", "<", True),
    ("zero_buckets", "earliest", "<", False),
    ("inverted_offsets", "earliest", "<", False),
    ("excessive_offsets", "earliest", "<", False),
    ("bad_dtype", "earliest", "<", False),
]:
    with h5py.File(OUT / f"{name}.hdf5", "w", libver=version) as f:
        f.attrs["n_hash_buckets"] = np.int64(0 if name == "zero_buckets" else 2)
        # Exercise both variable-length UTF-8 and fixed ASCII strings.
        f.attrs["hash_function"] = np.bytes_("identity") if compressed else "identity"
        f.attrs["dtype_bucket_entries"] = "uint32" if name == "bad_dtype" else "uint16"
        local_offsets = [2, 1, 4] if name == "inverted_offsets" else ([0, 2000000, 4] if name == "excessive_offsets" else offsets)
        for key, data, dtype in [("hash_bucket_offsets", local_offsets, "u8"), ("hash_buckets", buckets, "u8"), ("top_lefts", positions, "u2")]:
            array = np.array(data, dtype=endian + dtype)
            options = dict(chunks=(2,) if array.ndim == 1 else (2, 3), compression="gzip", shuffle=True, fletcher32=True) if compressed else {}
            f.create_dataset(key, data=array, **options)

# Real file oracle selects rows throughout the hash matrix, including its last entry.
real = ROOT / "binaryData/sample_organization/l4_sample/segmentation/segment_index/l4_sample_segment_index_file.hdf5"
shutil.copyfile(real, OUT / "real_l4_sample.hdf5")
with h5py.File(real, "r") as f:
    table = f["hash_buckets"][:]
    selected = sorted(set(np.linspace(0, len(table) - 1, 20, dtype=int).tolist()))
    oracle = {"n_hash_buckets": int(f.attrs["n_hash_buckets"]), "hash_function": f.attrs["hash_function"], "dtype_bucket_entries": f.attrs["dtype_bucket_entries"], "queries": []}
    for index in selected:
        segment, start, end = map(int, table[index])
        points = f["top_lefts"][start:end].astype(np.int16).astype(np.int32).tolist()
        oracle["queries"].append(dict(segment_id=str(segment), positions=points))
    (OUT / "real_oracle.json").write_text(json.dumps(oracle, separators=(",", ":")) + "\n")
