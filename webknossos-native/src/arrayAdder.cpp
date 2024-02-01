#include "com_scalableminds_webknossos_datastore_NativeArrayAdder.h"
#include <draco/src/draco/compression/encode.h>
#include <draco/src/draco/compression/decode.h>
#include <draco/src/draco/core/cycle_timer.h>
#include <draco/src/draco/io/file_utils.h>
#include <draco/src/draco/io/obj_encoder.h>
#include <draco/src/draco/io/parser_utils.h>
#include <draco/src/draco/io/ply_encoder.h>
#include <draco/src/draco/io/point_cloud_io.h>
#include <draco/src/draco/io/mesh_io.h>

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

  draco::DecoderBuffer dracoBuffer;

  env->ReleaseByteArrayElements(a, dataAsJByte, 0);

  const jsize outputLength = static_cast<jsize>(buffer.size());
  jbyteArray result = env->NewByteArray(outputLength);
  env->SetByteArrayRegion(result, 0, outputLength, reinterpret_cast<const jbyte*>(buffer.data()));
	return result;
}
