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


#include <sstream>
#include <string>
#include <iomanip>
#include <stdint.h>
#include <vector>
#include <iostream>

JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_NativeDracoToStlConverter_dracoToStl
  (JNIEnv* env, jobject instance, jbyteArray inputJavaArray)
{
  jsize inputLength = env->GetArrayLength(inputJavaArray);
  jbyte* dataAsJByte = env->GetByteArrayElements(inputJavaArray, NULL);
  const char *inputBytes = (const char*) dataAsJByte;

  draco::Decoder decoder;
  draco::DecoderBuffer dracoBuffer;
  dracoBuffer.Init(inputBytes, inputLength);

  auto statusOrMesh = decoder.DecodeMeshFromBuffer(&dracoBuffer);
  std::vector<uint8_t> buffer;
  if (statusOrMesh.ok()) {
    std::unique_ptr<draco::Mesh> mesh = std::move(statusOrMesh).value();

    draco::EncoderBuffer encodeBuffer;

    /*
    std::stringstream out;
    out << std::left << std::setw(80)
        << "generated using WEBKNOSSOS";  // header is 80 bytes fixed size.
    const std::string header_str = out.str();
    encodeBuffer.Encode(header_str.data(), header_str.length());
    */

    uint32_t num_faces = mesh->num_faces();

    // encodeBuffer.Encode(&num_faces, 4);

    std::vector<uint8_t> stl_face;

    const int positionAttributeId = mesh->GetNamedAttributeId(draco::GeometryAttribute::POSITION);

    // TODO error handling

    uint16_t unused = 0;

    for (draco::FaceIndex i(0); i < mesh->num_faces(); ++i) {
      const auto &face = mesh->face(i);
      const auto *const positionAttribute = mesh->attribute(positionAttributeId);

      draco::Vector3f pos[3];
      positionAttribute->GetMappedValue(face[0], &pos[0][0]);
      positionAttribute->GetMappedValue(face[1], &pos[1][0]);
      positionAttribute->GetMappedValue(face[2], &pos[2][0]);
      draco::Vector3f norm = draco::CrossProduct(pos[1] - pos[0], pos[2] - pos[0]);
      norm.Normalize();
      encodeBuffer.Encode(norm.data(), sizeof(float) * 3);

      for (int c = 0; c < 3; ++c) {
        encodeBuffer.Encode(positionAttribute->GetAddress(positionAttribute->mapped_index(face[c])),
                         positionAttribute->byte_stride());
      }

      encodeBuffer.Encode(&unused, 2);
    }


    std::cout << "num_faces: " << num_faces << ", encodeBuffer size: " << encodeBuffer.size() << std::endl;

    env->ReleaseByteArrayElements(inputJavaArray, dataAsJByte, 0);

    const jsize outputLength = static_cast<jsize>(encodeBuffer.size());
    jbyteArray result = env->NewByteArray(outputLength);
    env->SetByteArrayRegion(result, 0, outputLength, reinterpret_cast<const jbyte*>(encodeBuffer.data()));
    return result;
  } else {
    buffer.push_back(1);
  }

  env->ReleaseByteArrayElements(inputJavaArray, dataAsJByte, 0);

  const jsize outputLength = static_cast<jsize>(buffer.size());
  jbyteArray result = env->NewByteArray(outputLength);
  env->SetByteArrayRegion(result, 0, outputLength, reinterpret_cast<const jbyte*>(buffer.data()));
	return result;
}
