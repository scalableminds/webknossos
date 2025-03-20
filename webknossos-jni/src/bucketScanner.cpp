#include "com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner.h"

JNIEXPORT jlongArray JNICALL Java_com_scalableminds_webknossos_datastore_helpers_NativeBucketScanner_collectSegmentIds
  (JNIEnv * env, jobject instance, jbyteArray bucketBytes, jint bytesPerElement, jboolean isSigned) {


  jlongArray result = env -> NewLongArray(5);
  return result;
}
