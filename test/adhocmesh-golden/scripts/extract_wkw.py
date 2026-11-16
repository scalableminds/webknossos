# Extracts a cuboid of a uint32 LZ4-compressed WKW file (one file of l4_sample's segmentation, mag 1) as raw
# little-endian voxels (x fastest), gzipped. Usage (the l4_sample file z0/y3/x3.wkw starts at 3072, 3072, 0):
#   uv run --no-project --with lz4 python extract_wkw.py <file.wkw> <x> <y> <z> <sizeX> <sizeY> <sizeZ> <out.raw.gz>
# with x, y, z relative to the file's origin.
import sys, struct, lz4.block, gzip
path, ox, oy, oz, sx, sy, sz, out = sys.argv[1], *map(int, sys.argv[2:8]), sys.argv[8]
f = open(path, 'rb'); hdr = f.read(16)
assert hdr[:3] == b'WKW'
blen = 1 << (hdr[4] & 0xf); flen = 1 << (hdr[4] >> 4); btype = hdr[5]; vsize = hdr[7]
data_offset = struct.unpack('<Q', hdr[8:16])[0]
nblocks = flen**3
jump = struct.unpack('<%dQ' % nblocks, f.read(8 * nblocks))
def morton(x, y, z):
    r = 0
    for b in range(10):
        r |= ((x >> b) & 1) << (3*b) | ((y >> b) & 1) << (3*b+1) | ((z >> b) & 1) << (3*b+2)
    return r
cache = {}
def block(bx, by, bz):
    k = (bx, by, bz)
    if k not in cache:
        i = morton(bx, by, bz)
        start = data_offset if i == 0 else jump[i-1]
        f.seek(start); raw = f.read(jump[i] - start)
        cache[k] = lz4.block.decompress(raw, uncompressed_size=blen**3 * vsize)
    return cache[k]
out_b = bytearray(sx*sy*sz*vsize)
for z in range(sz):
    for y in range(sy):
        for x in range(sx):
            gx, gy, gz = ox+x, oy+y, oz+z
            b = block(gx//blen, gy//blen, gz//blen)
            li = ((gz%blen)*blen + gy%blen)*blen + gx%blen
            oi = (z*sy + y)*sx + x
            out_b[oi*vsize:(oi+1)*vsize] = b[li*vsize:(li+1)*vsize]
open(out, 'wb').write(gzip.compress(bytes(out_b), mtime=0))
import collections
c = collections.Counter(struct.unpack('<%dI' % (sx*sy*sz), out_b))
print(out, hdr.hex(), len(c), c.most_common(4))
