# Generates synthetic Draco meshes (DracoPy, several quantization/compression settings) and Compresso volumes
# (reference Python compresso package). Usage: python gen_synthetic.py <draco out dir> <compresso out dir>
# Needs: numpy, DracoPy, compresso
import sys, numpy as np, DracoPy, compresso
drc, cpso = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(7)
# Draco: a bumpy UV sphere, encoded with several quantization / compression settings.
nu, nv = 24, 16
u, v = np.meshgrid(np.linspace(0, 2*np.pi, nu, endpoint=False), np.linspace(0.1, np.pi-0.1, nv))
r = 50 + 5*rng.random(u.shape)
pts = np.stack([r*np.sin(v)*np.cos(u)+100, r*np.sin(v)*np.sin(u)+200, r*np.cos(v)+300], -1).reshape(-1,3).astype(np.float32)
faces = []
for i in range(nv-1):
    for j in range(nu):
        a, b, c, d = i*nu+j, i*nu+(j+1)%nu, (i+1)*nu+j, (i+1)*nu+(j+1)%nu
        faces += [[a, c, b], [b, c, d]]
faces = np.array(faces, dtype=np.uint32)
for q in (8, 11, 14, 16):
    for lvl in (0, 1, 7, 10):
        open(f"{drc}/synthetic_q{q}_level{lvl}.drc", "wb").write(DracoPy.encode(pts, faces, quantization_bits=q, compression_level=lvl))
# Compresso: blob-like label volumes of every dtype, sizes and connectivities.
def blobs(shape, n_labels, dtype, seed):
    r = np.random.default_rng(seed)
    labels = np.zeros(shape, dtype=dtype)
    for _ in range(n_labels * 3):
        c = [r.integers(0, s) for s in shape]; rad = [max(1, s // 4) for s in shape]
        sl = tuple(slice(max(0, ci - ri), ci + ri) for ci, ri in zip(c, rad))
        labels[sl] = dtype(r.integers(1, n_labels + 1)) if dtype != np.uint64 else np.uint64(r.integers(1, n_labels + 1)) + np.uint64(2**63)
    return labels
cases = [((32,32,32),np.uint8,4),((32,32,32),np.uint16,6),((64,64,16),np.uint32,4),((64,64,16),np.uint64,6),((17,23,5),np.uint32,4),((128,128,1),np.uint64,4),((32,32,32),np.uint64,6)]
for i,(shape,dt,conn) in enumerate(cases):
    lab = blobs(shape, 12, dt, i)
    lab = np.asfortranarray(lab)
    enc = compresso.compress(lab, connectivity=conn)
    assert np.array_equal(compresso.decompress(enc), lab)
    open(f"{cpso}/blobs_{i}_{dt.__name__}_{'x'.join(map(str,shape))}_c{conn}.cpso","wb").write(enc)
# Random noise (worst case: every voxel a boundary) and a constant volume.
noise = np.asfortranarray(np.random.default_rng(99).integers(0, 5, (16,16,16)).astype(np.uint16))
open(f"{cpso}/noise_uint16_16x16x16_c4.cpso","wb").write(compresso.compress(noise, connectivity=4))
const = np.asfortranarray(np.full((32,32,32), 7, dtype=np.uint32))
open(f"{cpso}/constant_uint32_32x32x32_c4.cpso","wb").write(compresso.compress(const, connectivity=4))
