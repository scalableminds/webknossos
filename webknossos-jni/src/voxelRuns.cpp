#include "voxelRuns.h"

#include <algorithm>
#include <cstring>
#include <stdexcept>

namespace {

const uint8_t voxelRunsFormatVersion = 1;
const size_t bucketWidth = 32;

template <typename T>
inline T readLittleEndian(const jbyte *bytes, size_t byteOffset) {
    // The voxel run wire format (see UpdateBucketPartialVolumeAction / VolumeBucketBuffer.applyVoxelRuns
    // on the Scala side) is little-endian by contract. This native library is only ever built for
    // little-endian targets (x86_64, arm64 in their default mode - see CMakeLists.txt and the
    // uname-based platform resolution in NativeLoaderUtils), so a plain memcpy of the raw bytes into
    // the target integer type is correct here without any byte-swapping. memcpy (rather than
    // reinterpret_cast) avoids alignment UB, matching typedValueAtIndex in bucketScanner.cpp.
    T value;
    std::memcpy(&value, bytes + byteOffset, sizeof(T));
    return value;
}

// Gaps, lengths and the run count never exceed 32768, so a varint has at most 3 bytes.
inline size_t readVarint(const jbyte *bytes, size_t lengthBytes, size_t &offset) {
    size_t result = 0;
    for (int shift = 0; shift < 21; shift += 7) {
        if (offset >= lengthBytes) {
            throw std::invalid_argument("voxelRuns buffer ends inside a varint");
        }
        const uint8_t byte = static_cast<uint8_t>(bytes[offset++]);
        result |= static_cast<size_t>(byte & 0x7f) << shift;
        if ((byte & 0x80) == 0) return result;
    }
    throw std::invalid_argument("varint in voxelRuns buffer is too long");
}

// In-place transpose of a 32x32 bit matrix: bit c of rows[r] becomes bit r of rows[c]. Swaps ever
// smaller off-diagonal blocks (16, 8, ..., 1), as in Hacker's Delight, with LSB-first bits. The
// inverse of what BucketVoxelMask.orderedRuns does in the frontend.
inline void transpose32(uint32_t *rows) {
    uint32_t mask = 0x0000ffff;
    for (unsigned size = 16; size != 0; size >>= 1, mask ^= mask << size) {
        for (unsigned k = 0; k < 32; k = (k + size + 1) & ~size) {
            const uint32_t swap = ((rows[k] >> size) ^ rows[k + size]) & mask;
            rows[k] ^= swap << size;
            rows[k + size] ^= swap;
        }
    }
}

// The three run orders are written differently, each so that the writes stay cache-friendly. A
// bucket is written through T*, as writeSegmentIdAtIndex does; signedness does not matter, since
// the value's low bytes are the same either way.

// x order: every run is one contiguous range of the bucket.
template <typename T>
void writeVoxelRunsXOrder(const jbyte *bytes, size_t lengthBytes, const VoxelRunsHeader &header, T *bucket) {
    const T value = static_cast<T>(header.value);
    size_t offset = header.runsOffset;
    size_t linear = 0;
    for (size_t i = 0; i < header.runCount; ++i) {
        linear += readVarint(bytes, lengthBytes, offset);
        const size_t length = readVarint(bytes, lengthBytes, offset);
        std::fill(bucket + linear, bucket + linear + length, value);
        linear += length;
    }
}

// y order (y, z, x): a run is a sequence of y-segments, each written with a stride of one row (32
// elements). Unlike z order, that stride spreads over the cache sets, so writing directly is fast.
template <typename T>
void writeVoxelRunsYOrder(const jbyte *bytes, size_t lengthBytes, const VoxelRunsHeader &header, T *bucket) {
    const T value = static_cast<T>(header.value);
    size_t offset = header.runsOffset;
    size_t linear = 0;
    for (size_t i = 0; i < header.runCount; ++i) {
        linear += readVarint(bytes, lengthBytes, offset);
        size_t remaining = readVarint(bytes, lengthBytes, offset);
        size_t y = linear % bucketWidth;
        size_t z = (linear / bucketWidth) % bucketWidth;
        size_t x = linear / (bucketWidth * bucketWidth);
        linear += remaining;
        while (remaining > 0) {
            const size_t count = std::min(bucketWidth - y, remaining);
            T *segment = bucket + x + (y + z * bucketWidth) * bucketWidth;
            for (size_t k = 0; k < count; ++k) segment[k * bucketWidth] = value;
            remaining -= count;
            y = 0;
            if (++z == bucketWidth) {
                z = 0;
                ++x;
            }
        }
    }
}

// z order (z, x, y): writing z-segments directly would mean a stride of 1024 elements, and
// addresses 4 KB apart all fall into the same L1 cache set, which thrashes it. Instead, the runs
// are set as bits in run order, where word x + 32y holds z = 0..31 of the slice y. Transposing a
// touched slice turns it into x-rows y + 32z, which are written like x-runs.
template <typename T>
void writeVoxelRunsZOrder(const jbyte *bytes, size_t lengthBytes, const VoxelRunsHeader &header, T *bucket) {
    uint32_t words[bucketWidth * bucketWidth];
    uint32_t touchedSlices = 0; // bit y: slice y has a run; its words are initialized
    size_t offset = header.runsOffset;
    size_t linear = 0;
    for (size_t i = 0; i < header.runCount; ++i) {
        linear += readVarint(bytes, lengthBytes, offset);
        const size_t end = linear + readVarint(bytes, lengthBytes, offset);
        while (linear < end) {
            const size_t word = linear / 32;
            const size_t slice = word / bucketWidth;
            if ((touchedSlices & (1u << slice)) == 0) {
                touchedSlices |= 1u << slice;
                std::fill(words + slice * bucketWidth, words + (slice + 1) * bucketWidth, 0u);
            }
            const size_t bit = linear % 32;
            const size_t bits = std::min<size_t>(32 - bit, end - linear);
            words[word] |= static_cast<uint32_t>(((uint64_t{1} << bits) - 1) << bit);
            linear += bits;
        }
    }
    const T value = static_cast<T>(header.value);
    while (touchedSlices != 0) {
        const unsigned y = __builtin_ctz(touchedSlices);
        touchedSlices &= touchedSlices - 1;
        uint32_t *slice = words + y * bucketWidth; // slice[x] has bit z
        transpose32(slice);                         // slice[z] has bit x
        for (size_t z = 0; z < bucketWidth; ++z) {
            uint32_t row = slice[z];
            T *rowStart = bucket + (y + z * bucketWidth) * bucketWidth;
            while (row != 0) {
                const unsigned start = __builtin_ctz(row);
                const uint32_t shifted = row >> start;
                // __builtin_ctz(0) is undefined, and ~shifted is 0 for a full row.
                const unsigned length = ~shifted == 0 ? 32 : __builtin_ctz(~shifted);
                std::fill(rowStart + start, rowStart + start + length, value);
                row &= ~static_cast<uint32_t>(((uint64_t{1} << length) - 1) << start);
            }
        }
    }
}

template <typename T>
void writeVoxelRunsTyped(const jbyte *bytes, size_t lengthBytes, const VoxelRunsHeader &header, jbyte *bucketBytes) {
    T *bucket = reinterpret_cast<T *>(bucketBytes);
    switch (header.runAxis) {
        case 1:
            return writeVoxelRunsYOrder<T>(bytes, lengthBytes, header, bucket);
        case 2:
            return writeVoxelRunsZOrder<T>(bytes, lengthBytes, header, bucket);
        default:
            return writeVoxelRunsXOrder<T>(bytes, lengthBytes, header, bucket);
    }
}

} // namespace

VoxelRunsHeader validateVoxelRuns(const jbyte *bytes, size_t lengthBytes) {
    // formatVersion, runAxis, value
    const size_t headerSizeBytes = 10;
    if (lengthBytes < headerSizeBytes) {
        throw std::invalid_argument("voxelRuns buffer is smaller than the mandatory 10-byte header");
    }
    if (static_cast<uint8_t>(bytes[0]) != voxelRunsFormatVersion) {
        throw std::invalid_argument("unknown voxelRuns format version");
    }
    VoxelRunsHeader header;
    header.runAxis = static_cast<uint8_t>(bytes[1]);
    if (header.runAxis > 2) {
        throw std::invalid_argument("unknown run axis in voxelRuns buffer");
    }
    header.value = readLittleEndian<uint64_t>(bytes, 2);

    size_t offset = headerSizeBytes;
    header.runCount = readVarint(bytes, lengthBytes, offset);
    if (header.runCount > bucketVoxelCount) {
        throw std::invalid_argument("voxelRuns buffer declares more runs than a bucket has voxels");
    }
    header.runsOffset = offset;
    size_t linear = 0;
    for (size_t i = 0; i < header.runCount; ++i) {
        linear += readVarint(bytes, lengthBytes, offset);
        linear += readVarint(bytes, lengthBytes, offset);
        if (linear > bucketVoxelCount) {
            throw std::invalid_argument("voxel run exceeds bucket bounds");
        }
    }
    // A truncated buffer fails above; trailing bytes mean it is not what the encoder wrote.
    if (offset != lengthBytes) {
        throw std::invalid_argument("voxelRuns buffer has trailing bytes after the declared runs");
    }
    return header;
}

void writeVoxelRuns(const jbyte *bytes, size_t lengthBytes, const VoxelRunsHeader &header, jbyte *bucketBytes,
                    int bytesPerElement) {
    switch (bytesPerElement) {
        case 1:
            return writeVoxelRunsTyped<uint8_t>(bytes, lengthBytes, header, bucketBytes);
        case 2:
            return writeVoxelRunsTyped<uint16_t>(bytes, lengthBytes, header, bucketBytes);
        case 4:
            return writeVoxelRunsTyped<uint32_t>(bytes, lengthBytes, header, bucketBytes);
        case 8:
            return writeVoxelRunsTyped<uint64_t>(bytes, lengthBytes, header, bucketBytes);
        default:
            throw std::invalid_argument("unsupported bytesPerElement for voxel runs");
    }
}
