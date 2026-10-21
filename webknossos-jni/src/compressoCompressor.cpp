#include "com_scalableminds_webknossos_datastore_compresso_NativeCompressoCompressor.h"

#include "jniutils.h"
#include "compresso.hpp"
#include <string>
#include <vector>

uint16_t combineUint16LittleEndian(uint8_t lower, uint8_t higher) {
    uint16_t combined = static_cast<uint16_t>(lower);
    combined |= static_cast<uint16_t>(higher) << 8;
    return combined;
}

size_t readOutputLengthFromHeader(unsigned char* inputBytes) {
    unsigned char dataWidth = inputBytes[5];
    uint16_t sizeX = combineUint16LittleEndian(inputBytes[6], inputBytes[7]);
    uint16_t sizeY = combineUint16LittleEndian(inputBytes[8], inputBytes[9]);
    uint16_t sizeZ = combineUint16LittleEndian(inputBytes[10], inputBytes[11]);

    return static_cast<size_t>(dataWidth) * static_cast<size_t>(sizeX) * static_cast<size_t>(sizeY) * static_cast<size_t>(sizeZ);
}

JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_compresso_NativeCompressoCompressor_decompress
    (JNIEnv *env, jobject instance, jbyteArray inputJavaArray, jint maxOutputLength) {

    const size_t inputLength = static_cast<size_t>(env->GetArrayLength(inputJavaArray));
    jbyte *inputJBytes = env->GetByteArrayElements(inputJavaArray, nullptr);
    if (inputJBytes == nullptr) {
        throwRuntimeException(env, "Error while decoding with compresso: Could not access input bytes");
        return nullptr;
    }
    unsigned char* inputBytes = reinterpret_cast<unsigned char*>(inputJBytes);

    try {
        if (inputLength < compresso::CompressoHeader::header_size) {
            env->ReleaseByteArrayElements(inputJavaArray, inputJBytes, JNI_ABORT);
            throwRuntimeException(env, "Error while decoding with compresso: Expected at least 36 bytes of input for the compresso header, got " + std::to_string(inputLength));
            return nullptr;
        }

        const size_t outputLength = readOutputLengthFromHeader(inputBytes);

        if (outputLength == 0 || maxOutputLength < 0 || outputLength > static_cast<size_t>(maxOutputLength)) {
            env->ReleaseByteArrayElements(inputJavaArray, inputJBytes, JNI_ABORT);
            throwRuntimeException(env, "Error while decoding with compresso: output length as read from header must be >0 and at most " + std::to_string(maxOutputLength) + ", got " + std::to_string(outputLength));
            return nullptr;
        }

        std::vector<unsigned char> outputBytes(outputLength);

        const int errorCode = compresso::decompress<void,void>(inputBytes, inputLength, outputBytes.data());

        if (errorCode != 0) {
            env->ReleaseByteArrayElements(inputJavaArray, inputJBytes, JNI_ABORT);
            throwRuntimeException(env, "Error while decoding with compresso: " + std::to_string(errorCode));
            return nullptr;
        }

        env->ReleaseByteArrayElements(inputJavaArray, inputJBytes, JNI_ABORT);
        const jsize outputJavaLength = static_cast<jsize>(outputLength);
        jbyteArray outputJavaArray = env->NewByteArray(outputJavaLength);
        if (outputJavaArray == nullptr) {
            return nullptr; // OutOfMemoryError is already pending
        }
        env->SetByteArrayRegion(outputJavaArray, 0, outputJavaLength, reinterpret_cast<const jbyte*>(outputBytes.data()));
        return outputJavaArray;
    } catch (const std::exception &e) {
        env->ReleaseByteArrayElements(inputJavaArray, inputJBytes, JNI_ABORT);
        throwRuntimeException(env, "Native Exception while decoding with compresso: " + std::string(e.what()));
        return nullptr;
    } catch (...) {
        env->ReleaseByteArrayElements(inputJavaArray, inputJBytes, JNI_ABORT);
        throwRuntimeException(env, "Native Exception while decoding with compresso");
        return nullptr;
    }
}
