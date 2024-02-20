#include "com_scalableminds_webknossos_datastore_NativeDracoToStlConverter.h"
#include <draco/compression/encode.h>
#include <draco/compression/decode.h>

#include <string>
#include <iostream>

void throwRuntimeException(JNIEnv* env, const std::string msg) {
    jclass exceptionClass = env->FindClass("java/lang/RuntimeException");

    if (exceptionClass != NULL) {
        env->ThrowNew(exceptionClass, ("An error occurred in native code: " + msg).c_str());
    }
}

// Takes a byte array containing a DRACO-Encoded mesh, adds offsetX, offsetY, offsetZ to each vertex
// And encodes the results as STL faces (50 bytes per face) BUT WITH NO STL HEADER.
JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_NativeDracoToStlConverter_dracoToStl
  (JNIEnv* env, jobject instance, jbyteArray inputJavaArray, jfloat offsetX, jfloat offsetY, jfloat offsetZ)
{
  jsize inputLength = env->GetArrayLength(inputJavaArray);
  jbyte* dataAsJByte = env->GetByteArrayElements(inputJavaArray, NULL);
  const char *inputBytes = (const char*) dataAsJByte;

  try {
    draco::Decoder decoder;
    draco::DecoderBuffer dracoBuffer;
    dracoBuffer.Init(inputBytes, inputLength);

    auto statusOrMesh = decoder.DecodeMeshFromBuffer(&dracoBuffer);

    if (statusOrMesh.ok()) {
      std::unique_ptr<draco::Mesh> mesh = std::move(statusOrMesh).value();

      // Successfully decoded DRACO bytes into a draco::Mesh object. Now encode it as STL faces.
      draco::EncoderBuffer encodeBuffer;

      const int positionAttributeId = mesh->GetNamedAttributeId(draco::GeometryAttribute::POSITION);
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

        for (int vertexIndex = 0; vertexIndex < 3; ++vertexIndex) {
          pos[vertexIndex][0] += offsetX;
          pos[vertexIndex][1] += offsetY;
          pos[vertexIndex][2] += offsetZ;
          encodeBuffer.Encode(&pos[vertexIndex], sizeof(float) * 3);
        }

        encodeBuffer.Encode(&unused, 2); // we write no face attributes, so attribute byte count is zero
      }

      const jsize outputLength = static_cast<jsize>(encodeBuffer.size());
      jbyteArray result = env->NewByteArray(outputLength);
      env->SetByteArrayRegion(result, 0, outputLength, reinterpret_cast<const jbyte*>(encodeBuffer.data()));
      env->ReleaseByteArrayElements(inputJavaArray, dataAsJByte, 0);
      return result;
    } else {
      env->ReleaseByteArrayElements(inputJavaArray, dataAsJByte, 0);
      throwRuntimeException(env, "Invalid DRACO Encoding in Mesh Byte Array");
      return env->NewByteArray(0);
    }
	} catch (...) {
    env->ReleaseByteArrayElements(inputJavaArray, dataAsJByte, 0);
    throwRuntimeException(env, "Native Exception while transcoding DRACO Mesh to STL Faces");
    return env->NewByteArray(0);
	}
}
