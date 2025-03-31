#include "com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner.h"

#include <unordered_set>
#include <stdexcept>
#include <iostream>
#include <vector>

uint64_t segmentIdAtIndex(unsigned char* bucketBytes, int index, int bytesPerElement, bool isSigned) {
    unsigned char* currentPos = bucketBytes + (index * bytesPerElement);
    long currentValue;
    switch (bytesPerElement) {
        case 1:
            currentValue = isSigned ?
                static_cast<long>(*reinterpret_cast<signed char*>(currentPos)) :
                static_cast<long>(*currentPos);
            break;
        case 2:
            currentValue = isSigned ?
                static_cast<long>(*reinterpret_cast<short*>(currentPos)) :
                static_cast<long>(*reinterpret_cast<unsigned short*>(currentPos));
            break;
        case 4:
            currentValue = isSigned ?
                static_cast<long>(*reinterpret_cast<int*>(currentPos)) :
                static_cast<long>(*reinterpret_cast<unsigned int*>(currentPos));
            break;
        case 8:
            currentValue = isSigned ?
                static_cast<long>(*reinterpret_cast<long*>(currentPos)) :
                static_cast<long>(*reinterpret_cast<unsigned long*>(currentPos));
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
    unsigned char* bucketBytesAsByteArray = reinterpret_cast<unsigned char*>(bucketBytesAsJByte);

    std::unordered_set<long> uniqueSegmentIds;

    size_t elementCount = inputLengthBytes / bytesPerElement;

    for (size_t i = 0; i < elementCount; ++i) {
        int64_t currentValue = segmentIdAtIndex(bucketBytesAsByteArray, i, bytesPerElement, isSigned);
        if (currentValue != 0) {
          uniqueSegmentIds.insert(currentValue);
        }
    }

    env -> ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytesAsJByte, 0);

    size_t resultCount = uniqueSegmentIds.size();
    long* result = new long[resultCount];
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
    unsigned char* bucketBytesAsByteArray = reinterpret_cast<unsigned char*>(bucketBytesAsJByte);

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
    jint existingBBoxTopLeftX, jint existingBBoxTopLeftY, jint existingBBoxTopLeftZ, jint existingBBoxBottomRightX, jint existingBBoxBottomRightY, jint existingBBoxBottomRightZ) {

    jsize inputLengthBytes = env -> GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytesAsJByte = env -> GetByteArrayElements(bucketBytesJavaArray, NULL);
    unsigned char* bucketBytesAsByteArray = reinterpret_cast<unsigned char*>(bucketBytesAsJByte);

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
