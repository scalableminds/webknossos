#include "com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner.h"

#include "jniutils.h"
#include <iostream>
#include <vector>
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
        throwRuntimeException(env, "Native Exception in BucketScanner collectSegmentIds: " + std::string(e.what()));
        return nullptr;
    } catch (...) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, 0);
        throwRuntimeException(env, "Native Exception in BucketScanner collectSegmentIds");
        return nullptr;
    }
}

JNIEXPORT jlong JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_countSegmentVoxels
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned, jlong segmentId) {

    jsize inputLengthBytes = env -> GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytes = env -> GetByteArrayElements(bucketBytesJavaArray, NULL);
    try {

        const size_t elementCount = getElementCount(inputLengthBytes, bytesPerElement);
        size_t segmentVoxelCount = 0;
        for (size_t i = 0; i < elementCount; ++i) {
            int64_t currentValue = segmentIdAtIndex(bucketBytes, i, bytesPerElement, isSigned);
            if (currentValue == segmentId) {
                segmentVoxelCount++;
            }
        }
        return segmentVoxelCount;

    } catch (const std::exception &e) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, 0);
        throwRuntimeException(env, "Native Exception in BucketScanner countSegmentVoxels: " + std::string(e.what()));
        return 0;
    } catch (...) {
        env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, 0);
        throwRuntimeException(env, "Native Exception in BucketScanner countSegmentVoxels");
        return 0;
    }
}


JNIEXPORT jintArray JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_extendSegmentBoundingBox
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned, jint bucketLength, jlong segmentId,
      jint bucketTopLeftX, jint bucketTopLeftY, jint bucketTopLeftZ,
      jint existingBBoxTopLeftX, jint existingBBoxTopLeftY, jint existingBBoxTopLeftZ,
      jint existingBBoxBottomRightX, jint existingBBoxBottomRightY, jint existingBBoxBottomRightZ) {

    jsize inputLengthBytes = env -> GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytes = env -> GetByteArrayElements(bucketBytesJavaArray, NULL);
    try {

        const size_t elementCount = getElementCount(inputLengthBytes, bytesPerElement);
        std::vector<int> bbox = {existingBBoxTopLeftX, existingBBoxTopLeftY, existingBBoxTopLeftZ, existingBBoxBottomRightX, existingBBoxBottomRightY, existingBBoxBottomRightZ};
        for (int x = 0; x < bucketLength; x++) {
            for (int y = 0; y < bucketLength; y++) {
                for (int z = 0; z < bucketLength; z++) {
                    int index = z * bucketLength * bucketLength + y * bucketLength + x;
                    int64_t currentValue = segmentIdAtIndex(bucketBytes, index, bytesPerElement, isSigned);
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
    } catch (const std::exception &e) {
         env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, 0);
         throwRuntimeException(env, "Native Exception in BucketScanner extendSegmentBoundingBox: " + std::string(e.what()));
         return nullptr;
     } catch (...) {
         env->ReleaseByteArrayElements(bucketBytesJavaArray, bucketBytes, 0);
         throwRuntimeException(env, "Native Exception in BucketScanner extendSegmentBoundingBox");
         return nullptr;
     }
}
