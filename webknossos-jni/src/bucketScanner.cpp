#include "com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner.h"

#include "jniutils.h"
#include <array>
#include <iostream>
#include <vector>
#include <stdexcept>
#include <unordered_set>
#include <stdint.h>
#include <map>
#include <algorithm>
#include <cstring>

void writeSegmentIdAtIndex(jbyte *bucketBytes, size_t index, int64_t segmentId, const int bytesPerElement, const int isSigned) {
    jbyte *currentPos = bucketBytes + (index * bytesPerElement);

    switch (bytesPerElement) {
        case 1:
            if (isSigned)
                *reinterpret_cast<int8_t *>(currentPos) = static_cast<int8_t>(segmentId);
            else
                *reinterpret_cast<uint8_t *>(currentPos) = static_cast<uint8_t>(segmentId);
            break;
        case 2:
            if (isSigned)
                *reinterpret_cast<int16_t *>(currentPos) = static_cast<int16_t>(segmentId);
            else
                *reinterpret_cast<uint16_t *>(currentPos) = static_cast<uint16_t>(segmentId);
            break;
        case 4:
            if (isSigned)
                *reinterpret_cast<int32_t *>(currentPos) = static_cast<int32_t>(segmentId);
            else
                *reinterpret_cast<uint32_t *>(currentPos) = static_cast<uint32_t>(segmentId);
            break;
        case 8:
            if (isSigned)
                *reinterpret_cast<int64_t *>(currentPos) = static_cast<int64_t>(segmentId);
            else
                *reinterpret_cast<uint64_t *>(currentPos) = static_cast<uint64_t>(segmentId);
            break;
        default:
            throw std::invalid_argument("Cannot write segment value, unsupported bytesPerElement value");
    }
}

int64_t segmentIdAtIndex(jbyte *bucketBytes, size_t index, const int bytesPerElement, const bool isSigned) {
    jbyte *currentPos = bucketBytes + (index * bytesPerElement);
    long currentValue;
    switch (bytesPerElement) {
    case 1:
        currentValue = isSigned ? static_cast<int64_t>(*reinterpret_cast<int8_t *>(currentPos))
                                : static_cast<int64_t>(*reinterpret_cast<uint8_t *>(currentPos));
        break;
    case 2:
        currentValue = isSigned ? static_cast<int64_t>(*reinterpret_cast<int16_t *>(currentPos))
                                : static_cast<int64_t>(*reinterpret_cast<uint16_t *>(currentPos));
        break;
    case 4:
        currentValue = isSigned ? static_cast<int64_t>(*reinterpret_cast<int32_t *>(currentPos))
                                : static_cast<int64_t>(*reinterpret_cast<uint32_t *>(currentPos));
        break;
    case 8:
        currentValue = isSigned ? static_cast<int64_t>(*reinterpret_cast<int64_t *>(currentPos))
                                : static_cast<int64_t>(*reinterpret_cast<uint64_t *>(currentPos));
        break;
    default:
        throw std::invalid_argument("Cannot read segment value, unsupported bytesPerElement value");
    }
    return currentValue;
}

jlongArray copyToJLongArray(JNIEnv *env, const std::unordered_set<int64_t> &source) {
    const size_t size = source.size();
    jlongArray target = env->NewLongArray(size);
    jlong *targetElements = env->GetLongArrayElements(target, nullptr);

    auto it = source.begin();
    for (size_t i = 0; i < source.size(); ++i) {
        targetElements[i] = static_cast<jlong>(*it);
        ++it;
    }
    env->ReleaseLongArrayElements(target, targetElements, 0);

    return target;
}

size_t getElementCount(jsize inputLengthBytes, jint bytesPerElement) {
    if (bytesPerElement == 0) {
        throw std::invalid_argument("bytesPerElement cannot be zero");
    }
    if (inputLengthBytes % bytesPerElement != 0) {
        throw std::invalid_argument("Bucket bytes length must be divisible by bytesPerElement");
    }
    return inputLengthBytes / bytesPerElement;
}

template <typename T>
inline int64_t typedValueAtIndex(const jbyte *bucketBytes, size_t index) {
    T value;
    // memcpy+static_cast instead of reinterpret_cast forces compiler to do this with correct alignment. No runtime cost.
    std::memcpy(&value, bucketBytes + index * sizeof(T), sizeof(T));
    return static_cast<int64_t>(value);
}

template <typename T>
inline T readLittleEndian(const jbyte *bytes, size_t byteOffset) {
    // The voxel run wire format (see UpdateBucketPartialVolumeAction / VolumeBucketBuffer.applyVoxelRuns
    // on the Scala side) is little-endian by contract. This native library is only ever built for
    // little-endian targets (x86_64, arm64 in their default mode - see CMakeLists.txt and the
    // uname-based platform resolution in NativeLoaderUtils), so a plain memcpy of the raw bytes into
    // the target integer type is correct here without any byte-swapping. memcpy (rather than
    // reinterpret_cast) avoids alignment UB, matching typedValueAtIndex above.
    T value;
    std::memcpy(&value, bytes + byteOffset, sizeof(T));
    return value;
}

// The voxel run wire format of updateBucketPartial (encodeBucketDiff in the frontend's
// viewer/model/volumetracing/core/bucket_diff.ts), little-endian:
//   uint8 formatVersion (1), uint8 runAxis, uint64 value, varint runCount,
//   then runCount times (varint gap, varint length).
// Runs are over the linear index of the run order whose fastest axis is runAxis
// (0: x,y,z; 1: y,z,x; 2: z,x,y), may cross rows and slices, and each gap is
// the distance from the previous run's end. Varints are unsigned LEB128.
const uint8_t voxelRunsFormatVersion = 1;
const size_t bucketWidth = 32;
const size_t bucketVoxelCount = bucketWidth * bucketWidth * bucketWidth;

struct VoxelRunsHeader {
    uint8_t runAxis;
    uint64_t value;
    size_t runCount;
    size_t runsOffset; // byte offset of the first run
};

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

// Checks the whole buffer without writing anything, so that a malformed one is rejected before the
// bucket is touched.
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
                const unsigned length = __builtin_ctz(~(row >> start));
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

// Writes validated voxel runs into a bucket of 32^3 elements.
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

template <typename T>
void collectSegmentIdsTyped(const jbyte *bucketBytes, size_t elementCount, bool skipZeroes,
                            std::unordered_set<int64_t> &uniqueSegmentIds) {
    bool lastValueIsKnown = false;
    int64_t lastValue = 0;
    for (size_t i = 0; i < elementCount; ++i) {
        const int64_t currentValue = typedValueAtIndex<T>(bucketBytes, i);
        if (lastValueIsKnown && currentValue == lastValue) {
            continue;
        }
        lastValue = currentValue;
        lastValueIsKnown = true;
        if (!skipZeroes || currentValue != 0) {
            uniqueSegmentIds.insert(currentValue);
        }
    }
}

JNIEXPORT jlongArray JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_collectSegmentIds(
    JNIEnv *env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned, jboolean skipZeroes) {

    const jsize inputLengthBytes = env->GetArrayLength(bucketBytesJavaArray);
    jbyte *bucketBytes = env->GetByteArrayElements(bucketBytesJavaArray, nullptr);
    try {
        const size_t elementCount = getElementCount(inputLengthBytes, bytesPerElement);

        std::unordered_set<int64_t> uniqueSegmentIds;
        switch (bytesPerElement) {
            case 1:
                if (isSigned) collectSegmentIdsTyped<int8_t>(bucketBytes, elementCount, skipZeroes, uniqueSegmentIds);
                else collectSegmentIdsTyped<uint8_t>(bucketBytes, elementCount, skipZeroes, uniqueSegmentIds);
                break;
            case 2:
                if (isSigned) collectSegmentIdsTyped<int16_t>(bucketBytes, elementCount, skipZeroes, uniqueSegmentIds);
                else collectSegmentIdsTyped<uint16_t>(bucketBytes, elementCount, skipZeroes, uniqueSegmentIds);
                break;
            case 4:
                if (isSigned) collectSegmentIdsTyped<int32_t>(bucketBytes, elementCount, skipZeroes, uniqueSegmentIds);
                else collectSegmentIdsTyped<uint32_t>(bucketBytes, elementCount, skipZeroes, uniqueSegmentIds);
                break;
            case 8:
                if (isSigned) collectSegmentIdsTyped<int64_t>(bucketBytes, elementCount, skipZeroes, uniqueSegmentIds);
                else collectSegmentIdsTyped<uint64_t>(bucketBytes, elementCount, skipZeroes, uniqueSegmentIds);
                break;
            default:
                throw std::invalid_argument("Cannot collect segment ids, unsupported bytesPerElement value");
        }

        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        return copyToJLongArray(env, uniqueSegmentIds);
    } catch (const std::exception &e) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner collectSegmentIds: " + std::string(e.what()));
        return nullptr;
    } catch (...) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner collectSegmentIds");
        return nullptr;
    }
}

JNIEXPORT jlong JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_countSegmentVoxels
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned, jlong segmentId) {

    jsize inputLengthBytes = env->GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytes = env->GetByteArrayElements(bucketBytesJavaArray, nullptr);
    try {

        const size_t elementCount = getElementCount(inputLengthBytes, bytesPerElement);
        size_t segmentVoxelCount = 0;
        for (size_t i = 0; i < elementCount; ++i) {
            int64_t currentValue = segmentIdAtIndex(bucketBytes, i, bytesPerElement, isSigned);
            if (currentValue == segmentId) {
                segmentVoxelCount++;
            }
        }
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        return segmentVoxelCount;

    } catch (const std::exception &e) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner countSegmentVoxels: " + std::string(e.what()));
        return 0;
    } catch (...) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner countSegmentVoxels");
        return 0;
    }
}

JNIEXPORT jintArray JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_extendSegmentBoundingBox
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned, jint bucketLength, jlong segmentId,
      jint bucketTopLeftX, jint bucketTopLeftY, jint bucketTopLeftZ,
      jint existingBBoxTopLeftX, jint existingBBoxTopLeftY, jint existingBBoxTopLeftZ,
      jint existingBBoxBottomRightX, jint existingBBoxBottomRightY, jint existingBBoxBottomRightZ) {

    jsize inputLengthBytes = env->GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytes = env->GetByteArrayElements(bucketBytesJavaArray, nullptr);
    try {

        const size_t elementCount = getElementCount(inputLengthBytes, bytesPerElement);
        if (elementCount != bucketLength * bucketLength * bucketLength) {
            throw std::invalid_argument("elementCount must match exactly one bucket.");
        }

        std::array<int, 6> bbox = {existingBBoxTopLeftX, existingBBoxTopLeftY, existingBBoxTopLeftZ, existingBBoxBottomRightX, existingBBoxBottomRightY, existingBBoxBottomRightZ};

        int index = 0;
        for (int z = 0; z < bucketLength; z++) {
            for (int y = 0; y < bucketLength; y++) {
                for (int x = 0; x < bucketLength; x++) {
                    int64_t currentValue = segmentIdAtIndex(bucketBytes, index, bytesPerElement, isSigned);
                    if (currentValue == segmentId) {
                        bbox[0] = std::min(bbox[0], x + bucketTopLeftX);
                        bbox[1] = std::min(bbox[1], y + bucketTopLeftY);
                        bbox[2] = std::min(bbox[2], z + bucketTopLeftZ);
                        bbox[3] = std::max(bbox[3], x + bucketTopLeftX);
                        bbox[4] = std::max(bbox[4], y + bucketTopLeftY);
                        bbox[5] = std::max(bbox[5], z + bucketTopLeftZ);
                    }
                    // The zyx loop matches the fortran order in the bucket, so we just need to increment index by one.
                    index++;
                }
            }
        }
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        jintArray resultAsJIntArray = env->NewIntArray(bbox.size());
        env->SetIntArrayRegion(resultAsJIntArray, 0, bbox.size(), reinterpret_cast < const jint * > (bbox.data()));

        return resultAsJIntArray;
    } catch (const std::exception &e) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner extendSegmentBoundingBox: " + std::string(e.what()));
        return nullptr;
    } catch (...) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner extendSegmentBoundingBox");
        return nullptr;
    }
}

JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_applySegmentIdMapping
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned, jlongArray idMappingSrcJavaArray, jlongArray idMappingDstJavaArray) {

    jsize bucketLengthBytes = env->GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytes = env->GetByteArrayElements(bucketBytesJavaArray, nullptr);
    jsize mapSize = env->GetArrayLength(idMappingSrcJavaArray);
    jlong * idMappingSrc = env->GetLongArrayElements(idMappingSrcJavaArray, nullptr);
    jlong * idMappingDst = env->GetLongArrayElements(idMappingDstJavaArray, nullptr);

    try {
        if (mapSize != env->GetArrayLength(idMappingDstJavaArray)) {
            throw std::invalid_argument("idMappingSrc and idMappingDst must have same length.");
        }
        std::map<int64_t, int64_t> mapping;
        for (size_t i = 0; i < mapSize; ++i) {
            mapping[idMappingSrc[i]] = idMappingDst[i];
        }

        const size_t elementCount = getElementCount(bucketLengthBytes, bytesPerElement);

        jbyteArray outputJavaArray = env->NewByteArray(bucketLengthBytes);
        jbyte *outputJBytes = env->GetByteArrayElements(outputJavaArray, nullptr);

        for (size_t i = 0; i < elementCount; ++i) {
            int64_t unmappedSegmentId = segmentIdAtIndex(bucketBytes, i, bytesPerElement, isSigned);
            int64_t mappedSegmentId = mapping[unmappedSegmentId];
            writeSegmentIdAtIndex(outputJBytes, i, mappedSegmentId, bytesPerElement, isSigned);
        }

        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingSrcJavaArray, idMappingSrc, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingDstJavaArray, idMappingDst, JNI_ABORT);
        env->ReleaseByteArrayElements(outputJavaArray, outputJBytes, 0);

        return outputJavaArray;

    } catch (const std::exception &e) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingSrcJavaArray, idMappingSrc, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingDstJavaArray, idMappingDst, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner applySegmentIdMapping: " + std::string(e.what()));
        return nullptr;
    } catch (...) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingSrcJavaArray, idMappingSrc, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingDstJavaArray, idMappingDst, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner applySegmentIdMapping");
        return nullptr;
    }
}

JNIEXPORT void JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_mergeVolumeBucketInPlace
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesMutableJavaArray, jbyteArray incomingBucketBytesJavaArray, jboolean skipMapping,
     jlongArray idMappingSrcJavaArray, jlongArray idMappingDstJavaArray, jint bytesPerElement, jboolean isSigned) {

    jsize bucketLengthBytes = env->GetArrayLength(bucketBytesMutableJavaArray);
    jbyte * bucketBytesMutable = env->GetByteArrayElements(bucketBytesMutableJavaArray, nullptr);
    jbyte * incomingBucketBytes = env->GetByteArrayElements(incomingBucketBytesJavaArray, nullptr);
    jsize mapSize = env->GetArrayLength(idMappingSrcJavaArray);
    jlong * idMappingSrc = env->GetLongArrayElements(idMappingSrcJavaArray, nullptr);
    jlong * idMappingDst = env->GetLongArrayElements(idMappingDstJavaArray, nullptr);

    try {
        const size_t elementCount = getElementCount(bucketLengthBytes, bytesPerElement);

        if (mapSize != env->GetArrayLength(idMappingDstJavaArray)) {
            throw std::invalid_argument("idMappingSrc and idMappingDst must have same length.");
        }
        if (bucketLengthBytes != env->GetArrayLength(incomingBucketBytesJavaArray)) {
            throw std::invalid_argument("bucketBytesMutable and incomingBucketBytes must have same length.");
        }

        std::map<int64_t, int64_t> mapping;
        if (!skipMapping) {
            for (size_t i = 0; i < mapSize; ++i) {
                mapping[idMappingSrc[i]] = idMappingDst[i];
            }
        }

        for (size_t i = 0; i < elementCount; ++i) {
            int64_t segmentId = segmentIdAtIndex(incomingBucketBytes, i, bytesPerElement, isSigned);
            if (segmentId == 0) {
                continue;
            }
            if (!skipMapping) {
                segmentId = mapping[segmentId];
            }
            writeSegmentIdAtIndex(bucketBytesMutable, i, segmentId, bytesPerElement, isSigned);
        }

        env->ReleaseByteArrayElements(bucketBytesMutableJavaArray, bucketBytesMutable, 0);
        env->ReleaseByteArrayElements(incomingBucketBytesJavaArray, incomingBucketBytes, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingSrcJavaArray, idMappingSrc, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingDstJavaArray, idMappingDst, JNI_ABORT);
    } catch (const std::exception &e) {
        env->ReleaseByteArrayElements(bucketBytesMutableJavaArray, bucketBytesMutable, 0);
        env->ReleaseByteArrayElements(incomingBucketBytesJavaArray, incomingBucketBytes, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingSrcJavaArray, idMappingSrc, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingDstJavaArray, idMappingDst, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner mergeVolumeBucketInPlace: " + std::string(e.what()));
    } catch (...) {
        env->ReleaseByteArrayElements(bucketBytesMutableJavaArray, bucketBytesMutable, 0);
        env->ReleaseByteArrayElements(incomingBucketBytesJavaArray, incomingBucketBytes, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingSrcJavaArray, idMappingSrc, JNI_ABORT);
        env->ReleaseLongArrayElements(idMappingDstJavaArray, idMappingDst, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner mergeVolumeBucketInPlace");
    }
}

JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_deleteSegmentFromBucket
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned, jlong segmentId) {

    jsize bucketLengthBytes = env->GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytes = env->GetByteArrayElements(bucketBytesJavaArray, nullptr);

    try {

        jbyteArray filteredBucketBytesJavaArray = env->NewByteArray(bucketLengthBytes);
        jbyte* filteredBucketBytes = env->GetByteArrayElements(filteredBucketBytesJavaArray, nullptr);

        const size_t elementCount = getElementCount(bucketLengthBytes, bytesPerElement);

        memcpy(filteredBucketBytes, bucketBytes, bucketLengthBytes);

        for (size_t i = 0; i < elementCount; ++i) {
            if (segmentIdAtIndex(filteredBucketBytes, i, bytesPerElement, isSigned) == segmentId) {
                writeSegmentIdAtIndex(filteredBucketBytes, i, 0, bytesPerElement, isSigned);
            }
        }

        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        env->ReleaseByteArrayElements(filteredBucketBytesJavaArray, filteredBucketBytes, 0);
        return filteredBucketBytesJavaArray;
    } catch (const std::exception &e) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner deleteSegmentFromBucket: " + std::string(e.what()));
        return nullptr;
    } catch (...) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner deleteSegmentFromBucket");
        return nullptr;
    }
}

JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_applyVoxelRuns
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned, jbyteArray voxelRunsJavaArray) {

    jsize bucketLengthBytes = env->GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytes = env->GetByteArrayElements(bucketBytesJavaArray, nullptr);
    jsize voxelRunsLengthBytes = env->GetArrayLength(voxelRunsJavaArray);
    jbyte * voxelRuns = env->GetByteArrayElements(voxelRunsJavaArray, nullptr);

    try {
        const size_t elementCount = getElementCount(bucketLengthBytes, bytesPerElement);

        if (elementCount != bucketVoxelCount) {
            throw std::invalid_argument("voxel runs can only be applied to a bucket of 32^3 elements");
        }

        // Validate everything before allocating/mutating the output array.
        const size_t voxelRunsLength = static_cast<size_t>(voxelRunsLengthBytes);
        const VoxelRunsHeader header = validateVoxelRuns(voxelRuns, voxelRunsLength);

        jbyteArray outputJavaArray = env->NewByteArray(bucketLengthBytes);
        jbyte *outputBytes = env->GetByteArrayElements(outputJavaArray, nullptr);
        memcpy(outputBytes, bucketBytes, bucketLengthBytes);

        // isSigned is irrelevant here: a value is written as its low bytesPerElement bytes either way.
        writeVoxelRuns(voxelRuns, voxelRunsLength, header, outputBytes, bytesPerElement);

        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        env->ReleaseByteArrayElements(voxelRunsJavaArray, voxelRuns, JNI_ABORT);
        env->ReleaseByteArrayElements(outputJavaArray, outputBytes, 0);
        return outputJavaArray;
    } catch (const std::exception &e) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        env->ReleaseByteArrayElements(voxelRunsJavaArray, voxelRuns, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner applyVoxelRuns: " + std::string(e.what()));
        return nullptr;
    } catch (...) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, JNI_ABORT);
        env->ReleaseByteArrayElements(voxelRunsJavaArray, voxelRuns, JNI_ABORT);
        throwRuntimeException(env, "Native Exception in BucketScanner applyVoxelRuns");
        return nullptr;
    }
}
