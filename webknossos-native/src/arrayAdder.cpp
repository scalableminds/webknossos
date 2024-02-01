#include "com_scalableminds_webknossos_datastore_NativeArrayAdder.h"

#include <stdint.h>

JNIEXPORT jint JNICALL Java_com_scalableminds_webknossos_datastore_NativeArrayAdder_add
  (JNIEnv* env, jobject instance, jbyteArray a, jint b)
{
  jsize numBytes = env->GetArrayLength(a);
  uint8_t *data = (uint8_t*) env->GetByteArrayElements(a, NULL);
  uint8_t result = 0;
  for(auto x = 0; x < numBytes; x++) {
    result += data[x];
  }
  env->ReleaseByteArrayElements(data, a, 0);
	return result;
}


