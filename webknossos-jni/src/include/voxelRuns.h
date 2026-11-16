#pragma once

#include <jni.h>
#include <stdint.h>
#include <stddef.h>

// The voxel run wire format of updateBucketPartial (encodeBucketDiff in the frontend's
// viewer/model/volumetracing/core/bucket_diff.ts), little-endian:
//   uint8 formatVersion (1), uint8 runAxis, uint64 value, varint runCount,
//   then runCount times (varint gap, varint length).
// Runs are over the linear index of the run order whose fastest axis is runAxis
// (0: x,y,z; 1: y,z,x; 2: z,x,y), may cross rows and slices, and each gap is
// the distance from the previous run's end. Varints are unsigned LEB128.

const size_t bucketVoxelCount = 32 * 32 * 32;

struct VoxelRunsHeader {
    uint8_t runAxis;
    uint64_t value;
    size_t runCount;
    size_t runsOffset; // byte offset of the first run
};

// Checks the whole buffer without writing anything, so that a malformed one is rejected before the
// bucket is touched.
VoxelRunsHeader validateVoxelRuns(const jbyte *bytes, size_t lengthBytes);

// Writes validated voxel runs into a bucket of 32^3 elements.
void writeVoxelRuns(const jbyte *bytes, size_t lengthBytes, const VoxelRunsHeader &header, jbyte *bucketBytes,
                    int bytesPerElement);
