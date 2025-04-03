#include "com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner.h"

#include "jniutils.h"
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <unordered_set>

uint64_t segmentIdAtIndex(jbyte *bucketBytes, size_t index, const int bytesPerElement, const bool isSigned) {
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
    env->ReleaseLongArrayElements(target, targetElements, JNI_COMMIT);

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

JNIEXPORT jlongArray JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_collectSegmentIds(
    JNIEnv *env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned) {

    const jsize inputLengthBytes = env->GetArrayLength(bucketBytesJavaArray);
    jbyte *bucketBytes = env->GetByteArrayElements(bucketBytesJavaArray, nullptr);
    try {
        const size_t elementCount = getElementCount(inputLengthBytes, bytesPerElement);

        std::unordered_set<int64_t> uniqueSegmentIds;

        for (size_t i = 0; i < elementCount; ++i) {
            const int64_t currentValue = segmentIdAtIndex(bucketBytes, i, bytesPerElement, isSigned);
            if (currentValue != 0) {
                uniqueSegmentIds.insert(currentValue);
            }
        }

        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, 0);
        return copyToJLongArray(env, uniqueSegmentIds);
    } catch (const std::exception &e) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, 0);
        throwRuntimeException(env, "Native Exception in BucketScanner: " + std::string(e.what()));
        return nullptr;
    } catch (...) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, 0);
        throwRuntimeException(env, "Native Exception in BucketScanner");
        return nullptr;
    }
}
