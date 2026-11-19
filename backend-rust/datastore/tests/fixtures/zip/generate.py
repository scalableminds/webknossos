"""Deterministic real ZIP fixtures; Python stdlib is the independent archive writer."""
from pathlib import Path
import io, struct, zipfile
root = Path(__file__).parent
out = io.BytesIO()
with zipfile.ZipFile(out, 'w') as archive:
    for name, data, method in [('root.txt', b'0123456789', 0), ('folder/', b'', 0), ('folder/a.bin', b'abcdef', 0), ('folder/deep/', b'', 0), ('folder/deep/b.bin', b'xyz', 0), ('unicode/\u00e4.txt', b'utf8', 0), ('compressed.txt', b'compressed payload' * 10, 8)]:
        info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0)); info.compress_type = method
        archive.writestr(info, data)
    archive.comment = b'independent Python zipfile fixture'
normal = out.getvalue(); (root / 'stored.zip').write_bytes(normal)
# Promote one central entry and the EOCD to ZIP64 without allocating a 4 GiB archive.
central = normal.index(b'PK\x01\x02'); eocd = normal.rindex(b'PK\x05\x06')
name_len, extra_len = struct.unpack_from('<HH', normal, central + 28)
assert extra_len == 0
extra_pos = central + 46 + name_len
extra = struct.pack('<HHQQQ', 1, 24, 10, 10, 0)
b = bytearray(normal[:eocd]); b[extra_pos:extra_pos] = extra
for offset in (20, 24, 42): struct.pack_into('<I', b, central + offset, 0xffffffff)
struct.pack_into('<H', b, central + 30, len(extra))
size = eocd - central + len(extra); z64pos = len(b)
b += struct.pack('<IQHHIIQQQQ', 0x06064b50, 44, 45, 45, 0, 0, 7, 7, size, central)
b += struct.pack('<IIQI', 0x07064b50, 0, z64pos, 1)
tail = bytearray(normal[eocd:]); struct.pack_into('<H', tail, 10, 0xffff); struct.pack_into('<II', tail, 12, 0xffffffff, 0xffffffff)
b += tail
(root / 'zip64.zip').write_bytes(b)
# Verify both archives independently, including their promoted metadata.
for name in ('stored.zip', 'zip64.zip'):
    with zipfile.ZipFile(root / name) as archive:
        assert archive.read('root.txt') == b'0123456789'
        assert archive.testzip() is None
