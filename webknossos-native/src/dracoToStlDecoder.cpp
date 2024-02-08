#include "com_scalableminds_webknossos_datastore_NativeDracoToStlConverter.h"
#include <draco/compression/encode.h>
#include <draco/compression/decode.h>
#include <draco/core/cycle_timer.h>
#include <draco/io/file_utils.h>
#include <draco/io/obj_encoder.h>
#include <draco/io/parser_utils.h>
#include <draco/io/ply_encoder.h>
#include <draco/io/point_cloud_io.h>
#include <draco/io/mesh_io.h>

#include <stdint.h>
#include <vector>

JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_NativeDracoToStlConverter_dracoToStl
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
