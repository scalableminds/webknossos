"""Small stored/ZIP64 fixtures for range reading; no extraction or native runtime."""
import argparse
import json
from pathlib import Path
import struct
import zipfile
import zlib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
out = args.output
out.mkdir(parents=True, exist_ok=True)

def normal(name, entries, comment=b"", force=False):
    with zipfile.ZipFile(out / (name + ".zip"), "w") as archive:
        archive.comment = comment
        for path, data, method in entries:
            info = zipfile.ZipInfo(path)
            info.compress_type = method
            with archive.open(info, "w", force_zip64=force) as file:
                file.write(data)

stored = zipfile.ZIP_STORED
normal("small", [("b", b"bbb", stored), ("a", b"aa", stored), ("c", b"c", stored)])
normal("five", [(f"name{i}", bytes([i]), stored) for i in range(5)])
normal("many", [(f"name{i}", bytes([i]), stored) for i in range(64)])
normal("collisions", [(name, name.encode(), stored) for name in ("Aa", "BB", "AaAa", "BBBB", "AaBB", "BBAa", "root")])
normal("basic", [("a.bin", bytes(range(32)), stored), ("dir/", b"", stored), ("dir/b.bin", b"nested", stored), ("empty", b"", stored),
                 ("unicodé/", b"", stored), ("unicodé/✓.bin", b"unicode", stored), ("implicit/leaf", b"no parent entry", stored),
                 ("compressed", b"compressed payload" * 10, zipfile.ZIP_DEFLATED)])
normal("long_comment", [("a.bin", b"comment-data", stored)], comment=b"X" * 65535)
normal("local_zip64", [("a.bin", b"forced-local64", stored)], force=True)
normal("duplicate", [("dup/", b"", stored), ("dup", b"final", stored), ("a", b"a", stored), ("b", b"b", stored), ("c", b"c", stored), ("d", b"d", stored)])

def zip64(name, size64=True, compressed64=True, offset64=True, end64=True, extra=None):
    path = b"a.bin"
    payload = b"zip64-content"
    crc = zlib.crc32(payload)
    local = struct.pack("<I5H3I2H", 0x04034b50, 45, 0, 0, 0, 0, crc, len(payload), len(payload), len(path), 0) + path + payload
    values = [len(payload)] * (int(size64) + int(compressed64)) + ([0] if offset64 else [])
    field = b"".join(struct.pack("<Q", n) for n in values)
    if extra is None:
        extra = struct.pack("<HH", 0x5455, 1) + b"x" + struct.pack("<HH", 1, len(field)) + field
    central = struct.pack("<I6H3I5H2I", 0x02014b50, 45, 45, 0, 0, 0, 0, crc, 0xffffffff if compressed64 else len(payload), 0xffffffff if size64 else len(payload),
                          len(path), len(extra), 0, 0, 0, 0, 0xffffffff if offset64 else 0) + path + extra
    metadata = local + central
    if end64:
        offset = len(metadata)
        metadata += struct.pack("<IQ2H2I4Q", 0x06064b50, 44, 45, 45, 0, 0, 1, 1, len(central), len(local))
        metadata += struct.pack("<IIQI", 0x07064b50, 0, offset, 1)
        footer = struct.pack("<I4H2IH", 0x06054b50, 0, 0, 0xffff, 0xffff, 0xffffffff, 0xffffffff, 0)
    else:
        footer = struct.pack("<I4H2IH", 0x06054b50, 0, 0, 1, 1, len(central), len(local), 0)
    (out / (name + ".zip")).write_bytes(metadata + footer)

zip64("central_zip64")
zip64("size_zip64", compressed64=False, offset64=False, end64=False)
zip64("compressed_zip64", size64=False, offset64=False, end64=False)
zip64("offset_zip64", size64=False, compressed64=False, end64=False)
zip64("missing_extra", extra=b"")
zip64("truncated_extra", compressed64=False, offset64=False, extra=struct.pack("<HH", 1, 7) + b"x" * 7)
(out / "missing_footer.zip").write_bytes(b"not a zip")
damaged = bytearray((out / "central_zip64.zip").read_bytes())
damaged[-42:-38] = b"bad!"
(out / "bad_locator.zip").write_bytes(damaged)
print("Generated stored/ZIP64/order/error fixtures")
