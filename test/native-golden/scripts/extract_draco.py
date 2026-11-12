# Extracts real Draco mesh chunks from WEBKNOSSOS HDF5 meshfiles of the public sample datasets.
# Usage: python extract_draco.py <binaryData/sample_organization> <output dir>
# Needs: h5py, numpy
import random
import struct
import sys

import h5py

SAMPLE_ORGANIZATION, OUT = sys.argv[1], sys.argv[2]
MESHFILES = [
    ("l4sample", "l4_sample/segmentation/meshes/meshfile_4-4-1.hdf5"),
    ("e2006", "Sample_e2006_wkw_with_reconstructed_neurons2/segmentation/meshes/meshfile.hdf5"),
]


def parse_chunk_sizes(manifest):
    # Neuroglancer multi-resolution segment manifest, see NeuroglancerSegmentManifest.fromBytes
    offset = 0

    def read(count, fmt):
        nonlocal offset
        values = struct.unpack_from("<" + fmt * count, manifest, offset)
        offset += struct.calcsize("<" + fmt * count)
        return values

    read(3, "f")  # chunk shape
    read(3, "f")  # grid origin
    (num_lods,) = read(1, "I")
    read(num_lods, "f")  # lod scales
    read(num_lods * 3, "f")  # vertex offsets
    chunks_per_lod = read(num_lods, "I")
    sizes = []
    for lod in range(num_lods):
        read(3 * chunks_per_lod[lod], "I")  # chunk positions
        sizes.append(list(read(chunks_per_lod[lod], "I")))
    return sizes


def chunks_for_segment(neuroglancer, manifest_start, manifest_end):
    # The chunks of a segment are stored directly before its manifest, see NeuroglancerMeshHelper.enrichSegmentInfo
    sizes = parse_chunk_sizes(bytes(neuroglancer[manifest_start:manifest_end]))
    position = manifest_start - sum(map(sum, sizes))
    chunks = []
    for lod, lod_sizes in enumerate(sizes):
        for size in lod_sizes:
            chunks.append((lod, position, size))
            position += size
    return chunks


def collect(name, neuroglancer, buckets, rnd, n_segments=14, per_segment=3):
    rows = [row for row in buckets if row[2] > row[1]]
    rnd.shuffle(rows)
    picked = 0
    for segment_id, start, end in rows[:n_segments]:
        chunks = [chunk for chunk in chunks_for_segment(neuroglancer, int(start), int(end)) if chunk[2] > 0]
        rnd.shuffle(chunks)
        for lod, position, size in chunks[:per_segment]:
            if size > 60000:
                continue
            data = bytes(neuroglancer[position : position + size])
            assert data[:5] == b"DRACO", (name, segment_id, position)
            with open(f"{OUT}/{name}_seg{segment_id}_lod{lod}_{position}.drc", "wb") as f:
                f.write(data)
            picked += 1
    print(name, picked)


rnd = random.Random(42)
for name, path in MESHFILES:
    with h5py.File(f"{SAMPLE_ORGANIZATION}/{path}", "r") as meshfile:
        collect(name, meshfile["neuroglancer"], meshfile["buckets"][:], rnd)
