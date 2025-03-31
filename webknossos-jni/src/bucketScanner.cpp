#include "com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner.h"

#include <unordered_set>
#include <stdexcept>
#include <iostream>


JNIEXPORT jlongArray JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_collectSegmentIds
    (JNIEnv * env, jobject instance, jbyteArray bucketBytesJavaArray, jint bytesPerElement, jboolean isSigned) {

    jsize inputLengthBytes = env -> GetArrayLength(bucketBytesJavaArray);
    jbyte * bucketBytesAsJByte = env -> GetByteArrayElements(bucketBytesJavaArray, NULL);
    unsigned char* bucketBytesAsByteArray = reinterpret_cast<unsigned char*>(bucketBytesAsJByte);

    std::unordered_set<long> uniqueSegmentIds;

    size_t elementCount = inputLengthBytes / bytesPerElement;

    for (size_t i = 0; i < elementCount; ++i) {
        unsigned char* currentPos = bucketBytesAsByteArray + (i * bytesPerElement);
        long currentValue;
        switch (bytesPerElement) {
            case 1:
                currentValue = isSigned ?
                    static_cast<long>(*reinterpret_cast<const signed char*>(const_cast<unsigned char*>(currentPos))) :
                    static_cast<long>(*currentPos);
                break;
            case 2:
                currentValue = isSigned ?
                    static_cast<long>(*reinterpret_cast<const short*>(const_cast<unsigned char*>(currentPos))) :
                    static_cast<long>(*reinterpret_cast<const unsigned short*>(const_cast<unsigned char*>(currentPos)));
                break;
            case 4:
                currentValue = isSigned ?
                    static_cast<long>(*reinterpret_cast<const int*>(const_cast<unsigned char*>(currentPos))) :
                    static_cast<long>(*reinterpret_cast<const unsigned int*>(const_cast<unsigned char*>(currentPos)));
                break;
            case 8:
                currentValue = isSigned ?
                    static_cast<long>(*reinterpret_cast<const long*>(const_cast<unsigned char*>(currentPos))) :
                    static_cast<long>(*reinterpret_cast<const unsigned long*>(const_cast<unsigned char*>(currentPos)));
                break;
            default:
                throw std::invalid_argument("Cannot read segment value, unsupported bytesPerElement value");
        }
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
      long currentValue;
      switch (bytesPerElement) {
          case 1:
              currentValue = isSigned ?
                  static_cast<long>(*reinterpret_cast<const signed char*>(const_cast<unsigned char*>(currentPos))) :
                  static_cast<long>(*currentPos);
              break;
          case 2:
              currentValue = isSigned ?
                  static_cast<long>(*reinterpret_cast<const short*>(const_cast<unsigned char*>(currentPos))) :
                  static_cast<long>(*reinterpret_cast<const unsigned short*>(const_cast<unsigned char*>(currentPos)));
              break;
          case 4:
              currentValue = isSigned ?
                  static_cast<long>(*reinterpret_cast<const int*>(const_cast<unsigned char*>(currentPos))) :
                  static_cast<long>(*reinterpret_cast<const unsigned int*>(const_cast<unsigned char*>(currentPos)));
              break;
          case 8:
              currentValue = isSigned ?
                  static_cast<long>(*reinterpret_cast<const long*>(const_cast<unsigned char*>(currentPos))) :
                  static_cast<long>(*reinterpret_cast<const unsigned long*>(const_cast<unsigned char*>(currentPos)));
              break;
          default:
              throw std::invalid_argument("Unsupported bytes per element");
      }
      if (currentValue == segmentId) {
        segmentVoxelCount++;
      }
  }

  return segmentVoxelCount;
}
