#include "com_scalableminds_webknossos_datastore_NativeArrayAdder.h"

#include <stdint.h>
#include <vector>

JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_NativeArrayAdder_add
  (JNIEnv* env, jobject instance, jbyteArray a)
{
  jsize inputLength = env->GetArrayLength(a);
  jbyte* dataAsJByte = env->GetByteArrayElements(a, NULL);
  uint8_t *data = (uint8_t*) dataAsJByte;
  std::vector<uint8_t> buffer;
  for(auto i = 0; i < inputLength; i++) {
    for (auto j = 0; j < data[i]; j++) {
      buffer.push_back(data[i]);
    }
  }
  env->ReleaseByteArrayElements(a, dataAsJByte, 0);

  const jsize outputLength = static_cast<jsize>(buffer.size());
  jbyteArray result = env->NewByteArray(outputLength);
  env->SetByteArrayRegion(result, 0, outputLength, reinterpret_cast<const jbyte*>(buffer.data()));
	return result;
}

