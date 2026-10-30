"""Independent Zarr3 fixtures. Run with uv run --with zarr==3.4.1 python this_file."""
from pathlib import Path
import json
import numpy as np
import zarr
from zarr.codecs import BytesCodec, TransposeCodec, GzipCodec, ZstdCodec, BloscCodec, Crc32cCodec, ShardingCodec

root = Path(__file__).resolve().parents[1] / "datastore/tests/fixtures/zarr3"
root.mkdir(parents=True, exist_ok=True)
c,x,y,z = np.indices((1,7,6,5))
values = np.asarray(1+x+20*y+400*z, dtype=np.uint16)
values[:, :2,:3,:2] = 0  # missing inner chunk in sharded fixtures
cases = [
    ("big_c", BytesCodec(endian="big"), [], []),
    ("little_f", BytesCodec(endian="little"), [TransposeCodec(order=(3,2,1,0))], []),
    ("gzip", BytesCodec(), [], [GzipCodec(level=5)]),
    ("zstd", BytesCodec(), [], [ZstdCodec(level=3, checksum=True)]),
    ("blosc", BytesCodec(), [], [BloscCodec(cname="lz4", typesize=2, shuffle="bitshuffle")]),
    ("crc", BytesCodec(), [], [Crc32cCodec()]),
]
for name, serializer, filters, compressors in cases:
    a = zarr.create_array(str(root/name), shape=values.shape, chunks=(1,2,3,2), dtype=values.dtype, serializer=serializer, filters=filters, compressors=compressors, fill_value=0, overwrite=True)
    a[:] = values
    (root/name/"expected.bin").write_bytes(a[:,1:7,1:6,1:5].tobytes(order="F"))
for location in ["start", "end"]:
    name = "shard_"+location
    serializer = ShardingCodec(chunk_shape=(1,2,3,2), codecs=[BytesCodec(),GzipCodec()], index_codecs=[BytesCodec(),Crc32cCodec()], index_location=location)
    a = zarr.create_array(str(root/name), shape=values.shape, chunks=(1,4,6,4), dtype=values.dtype, serializer=serializer, filters=[], compressors=[], fill_value=0, overwrite=True)
    a[:] = values
    (root/name/"expected.bin").write_bytes(a[:,1:7,1:6,1:5].tobytes(order="F"))
(root/"oracle.json").write_text(json.dumps({"generator":"zarr-python", "version":zarr.__version__, "offset":[1,1,1], "shape":[6,5,4], "channels":1}, indent=2)+"\n")
