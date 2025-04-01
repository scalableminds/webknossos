#include "com_scalableminds_webknossos_datastore_draco_NativeDracoToStlConverter.h"

#include "jniutils.h"
#include <draco/compression/encode.h>
#include <draco/compression/decode.h>
#include <string>

// Takes a byte array containing a DRACO-Encoded mesh, adds offsetX, offsetY, offsetZ to each vertex
// And encodes the results as STL faces (50 bytes per face)
// No STL Header is included, as this will be called on chunks. The caller must add an stl header.
JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_draco_NativeDracoToStlConverter_dracoToStl
    (JNIEnv * env, jobject instance, jbyteArray inputJavaArray, jfloat offsetX, jfloat offsetY, jfloat offsetZ, jdouble scaleX, jdouble scaleY, jdouble scaleZ) {
        jsize inputLength = env -> GetArrayLength(inputJavaArray);
        jbyte * dataAsJByte = env -> GetByteArrayElements(inputJavaArray, NULL);
        const char * inputBytes = reinterpret_cast < const char * > (dataAsJByte);

        try {
            draco::Decoder decoder;
            draco::DecoderBuffer dracoBuffer;
            dracoBuffer.Init(inputBytes, inputLength);

            auto statusOrMesh = decoder.DecodeMeshFromBuffer( & dracoBuffer);

            if (statusOrMesh.ok()) {
                std::unique_ptr < draco::Mesh > mesh = std::move(statusOrMesh).value();

                // Successfully decoded DRACO bytes into a draco::Mesh object. Now encode it as STL faces.
                draco::EncoderBuffer encodeBuffer;

                const int positionAttributeId = mesh -> GetNamedAttributeId(draco::GeometryAttribute::POSITION);
                uint16_t unused = 0;

                for (draco::FaceIndex faceIndex(0); faceIndex < mesh -> num_faces(); ++faceIndex) {
                    const auto & face = mesh -> face(faceIndex);
                    const auto * const positionAttribute = mesh -> attribute(positionAttributeId);

                    draco::Vector3f pos[3];
                    positionAttribute -> GetMappedValue(face[0], & pos[0][0]);
                    positionAttribute -> GetMappedValue(face[1], & pos[1][0]);
                    positionAttribute -> GetMappedValue(face[2], & pos[2][0]);
                    draco::Vector3f norm = draco::CrossProduct(pos[1] - pos[0], pos[2] - pos[0]);
                    norm.Normalize();
                    encodeBuffer.Encode(norm.data(), sizeof(float) * 3);

                    for (int vertexIndex = 0; vertexIndex < 3; ++vertexIndex) {
                        pos[vertexIndex][0] += offsetX;
                        pos[vertexIndex][1] += offsetY;
                        pos[vertexIndex][2] += offsetZ;
                        pos[vertexIndex][0] *= scaleX;
                        pos[vertexIndex][1] *= scaleY;
                        pos[vertexIndex][2] *= scaleZ;
                        encodeBuffer.Encode( & pos[vertexIndex], sizeof(float) * 3);
                    }

                    encodeBuffer.Encode( & unused, 2); // we write no face attributes, so attribute byte count is zero
                }

                const jsize outputLength = static_cast < jsize > (encodeBuffer.size());
                jbyteArray result = env -> NewByteArray(outputLength);
                env -> SetByteArrayRegion(result, 0, outputLength, reinterpret_cast < const jbyte * > (encodeBuffer.data()));
                env -> ReleaseByteArrayElements(inputJavaArray, dataAsJByte, 0);
                return result;
            } else {
                env -> ReleaseByteArrayElements(inputJavaArray, dataAsJByte, 0);
                throwRuntimeException(env, "Invalid DRACO Encoding in Mesh Byte Array");
                return nullptr;
            }
        } catch (const std::exception & e) {
            env -> ReleaseByteArrayElements(inputJavaArray, dataAsJByte, 0);
            throwRuntimeException(env, "Native Exception while transcoding DRACO Mesh to STL Faces: " + std::string(e.what()));
            return nullptr;
        } catch (...) {
            env -> ReleaseByteArrayElements(inputJavaArray, dataAsJByte, 0);
            throwRuntimeException(env, "Native Exception while transcoding DRACO Mesh to STL Faces");
            return nullptr;
        }
    }
