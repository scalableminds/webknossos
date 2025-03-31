#include "com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner.h"

#include <unordered_set>
#include <stdexcept>
#include <iostream>
#include <vector>

uint64_t segmentIdAtIndex(uint8_t* bucketBytes, int index, int bytesPerElement, bool isSigned) {
    uint8_t* currentPos = bucketBytes + (index * bytesPerElement);
    long currentValue;
    switch (bytesPerElement) {
        case 1:
            currentValue = isSigned ?
                static_cast<int64_t>(*reinterpret_cast<int8_t*>(currentPos)) :
                static_cast<int64_t>(*currentPos);
            break;
        case 2:
            currentValue = isSigned ?
                static_cast<int64_t>(*reinterpret_cast<int16_t*>(currentPos)) :
                static_cast<int64_t>(*reinterpret_cast<uint16_t*>(currentPos));
            break;
        case 4:
            currentValue = isSigned ?
                static_cast<int64_t>(*reinterpret_cast<int32_t*>(currentPos)) :
                static_cast<int64_t>(*reinterpret_cast<uint32_t*>(currentPos));
            break;
        case 8:
            currentValue = isSigned ?
                static_cast<int64_t>(*reinterpret_cast<int64_t*>(currentPos)) :
                static_cast<int64_t>(*reinterpret_cast<uint64_t*>(currentPos));
            break;
        default:
            throw std::invalid_argument("Cannot read segment value, unsupported bytesPerElement value");
    }
    return currentValue;
}


JNIEXPORT jlongArray JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_collectSegmentIds
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned) {

    jsize inputLengthBytes = env -> GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytesAsJByte = env -> GetByteArrayElements(bucketBytesJavaArray, NULL);
    uint8_t* bucketBytesAsByteArray = reinterpret_cast<uint8_t*>(bucketBytesAsJByte);

    std::unordered_set<int64_t> uniqueSegmentIds;

    size_t elementCount = inputLengthBytes / bytesPerElement;

    for (size_t i = 0; i < elementCount; ++i) {
        int64_t currentValue = segmentIdAtIndex(bucketBytesAsByteArray, i, bytesPerElement, isSigned);
        if (currentValue != 0) {
          uniqueSegmentIds.insert(currentValue);
        }
    }

    env -> ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytesAsJByte, 0);

    size_t resultCount = uniqueSegmentIds.size();
    int64_t* result = new int64_t[resultCount];
    size_t idx = 0;
    for (const auto& value : uniqueSegmentIds) {
        result[idx++] = value;
    }

    jlongArray resultAsJLongArray = env -> NewLongArray(resultCount);
    env -> SetLongArrayRegion(resultAsJLongArray, 0, resultCount, reinterpret_cast < const jlong * > (result));

    return resultAsJLongArray;
}

JNIEXPORT jlong JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_countSegmentVoxels
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned, jlong segmentId) {

    jsize inputLengthBytes = env -> GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytesAsJByte = env -> GetByteArrayElements(bucketBytesJavaArray, NULL);
    uint8_t* bucketBytesAsByteArray = reinterpret_cast<uint8_t*>(bucketBytesAsJByte);

    size_t elementCount = inputLengthBytes / bytesPerElement;

    size_t segmentVoxelCount = 0;


    for (size_t i = 0; i < elementCount; ++i) {
        unsigned char* currentPos = bucketBytesAsByteArray + (i * bytesPerElement);
        int64_t currentValue = segmentIdAtIndex(bucketBytesAsByteArray, i, bytesPerElement, isSigned);
        if (currentValue == segmentId) {
            segmentVoxelCount++;
        }
    }

    return segmentVoxelCount;
}


JNIEXPORT jintArray JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_extendSegmentBoundingBox
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned, jint bucketLength, jlong segmentId,
      jint bucketTopLeftX, jint bucketTopLeftY, jint bucketTopLeftZ,
      jint existingBBoxTopLeftX, jint existingBBoxTopLeftY, jint existingBBoxTopLeftZ,
      jint existingBBoxBottomRightX, jint existingBBoxBottomRightY, jint existingBBoxBottomRightZ) {

    jsize inputLengthBytes = env -> GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytesAsJByte = env -> GetByteArrayElements(bucketBytesJavaArray, NULL);
    uint8_t* bucketBytesAsByteArray = reinterpret_cast<uint8_t*>(bucketBytesAsJByte);

    std::vector<int> bbox = {existingBBoxTopLeftX, existingBBoxTopLeftY, existingBBoxTopLeftZ, existingBBoxBottomRightX, existingBBoxBottomRightY, existingBBoxBottomRightZ};

    for (int x = 0; x < bucketLength; x++) {
        for (int y = 0; y < bucketLength; y++) {
            for (int z = 0; z < bucketLength; z++) {
                int index = z * bucketLength * bucketLength + y * bucketLength + x;
                int64_t currentValue = segmentIdAtIndex(bucketBytesAsByteArray, index, bytesPerElement, isSigned);
                if (currentValue == segmentId) {
                    bbox[0] = std::min(bbox[0], x + bucketTopLeftX);
                    bbox[1] = std::min(bbox[1], y + bucketTopLeftY);
                    bbox[2] = std::min(bbox[2], z + bucketTopLeftZ);
                    bbox[3] = std::max(bbox[3], x + bucketTopLeftX);
                    bbox[4] = std::max(bbox[4], y + bucketTopLeftY);
                    bbox[5] = std::max(bbox[5], z + bucketTopLeftZ);
                }
            }
        }
    }

    jintArray resultAsJIntArray = env -> NewIntArray(bbox.size());
    env -> SetIntArrayRegion(resultAsJIntArray, 0, bbox.size(), reinterpret_cast < const jint * > (bbox.data()));

    return resultAsJIntArray;
}
