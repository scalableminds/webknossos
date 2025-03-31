#include "com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner.h"

#include <unordered_set>
#include <stdexcept>
#include <iostream>

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
        uint8_t* currentPos = bucketBytesAsByteArray + (i * bytesPerElement);
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
