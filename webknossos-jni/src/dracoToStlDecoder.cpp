#include "com_scalableminds_webknossos_datastore_draco_NativeDracoToStlConverter.h"

#include <draco/compression/encode.h>
#include <draco/compression/decode.h>

#include <string>
#include <math.h>

void throwRuntimeException(JNIEnv * env,
    const std::string msg) {
    jclass exceptionClass = env -> FindClass("java/lang/RuntimeException");

    if (exceptionClass != nullptr) {
        env -> ThrowNew(exceptionClass, ("An error occurred in native code: " + msg).c_str());
    }
}

uint16_t extractUint16(float value) {
        uint32_t as_int;
        std::memcpy(&as_int, &value, sizeof(float)); // safely copy bits

        uint16_t last_16_bits = static_cast<uint16_t>(as_int & 0xFFFF); // mask lower 16 bits
        return last_16_bits;
}



// Takes a byte array containing a DRACO-Encoded mesh, adds offsetX, offsetY, offsetZ to each vertex
// And encodes the results as STL faces (50 bytes per face)
// No STL Header is included, as this will be called on chunks. The caller must add an stl header.
JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_draco_NativeDracoToStlConverter_dracoToStl
    (JNIEnv * env, jobject instance, jbyteArray inputJavaArray, jfloat offsetX, jfloat offsetY, jfloat offsetZ, jdouble scaleX, jdouble scaleY, jdouble scaleZ, jint vertexQuantizationBits) {
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
                const double vertexQuantizationFactor = pow(2, 16) - 1;

                for (draco::FaceIndex faceIndex(0); faceIndex < mesh -> num_faces(); ++faceIndex) {
                    const auto & face = mesh -> face(faceIndex);
                    const auto * const positionAttribute = mesh -> attribute(positionAttributeId);

                    draco::Vector3f pos[3];
                    positionAttribute -> GetMappedValue(face[0], & pos[0][0]);
                    positionAttribute -> GetMappedValue(face[1], & pos[1][0]);
                    positionAttribute -> GetMappedValue(face[2], & pos[2][0]);

                    if(vertexQuantizationBits > 0) {
                      auto vertexQuantizationFactor = 1 / (pow(2, double(vertexQuantizationBits)) - 1);
                      pos[0][0] = float(extractUint16(pos[0][0])) * vertexQuantizationFactor;
                      pos[0][1] = float(extractUint16(pos[0][1])) * vertexQuantizationFactor;
                      pos[0][2] = float(extractUint16(pos[0][2])) * vertexQuantizationFactor;
                      pos[1][0] = float(extractUint16(pos[1][0])) * vertexQuantizationFactor;
                      pos[1][1] = float(extractUint16(pos[1][1])) * vertexQuantizationFactor;
                      pos[1][2] = float(extractUint16(pos[1][2])) * vertexQuantizationFactor;
                      pos[2][0] = float(extractUint16(pos[2][0])) * vertexQuantizationFactor;
                      pos[2][1] = float(extractUint16(pos[2][1])) * vertexQuantizationFactor;
                      pos[2][2] = float(extractUint16(pos[2][2])) * vertexQuantizationFactor;
                    }

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
