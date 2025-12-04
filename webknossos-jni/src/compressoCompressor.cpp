#include "com_scalableminds_webknossos_datastore_compresso_NativeCompressoCompressor.h"

#include "jniutils.h"
#include "compresso.hpp"
#include<string>

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
    (JNIEnv *env, jobject instance, jbyteArray inputJavaArray) {

    const size_t inputLength = static_cast<size_t>(env->GetArrayLength(inputJavaArray));
    jbyte *inputJBytes = env->GetByteArrayElements(inputJavaArray, nullptr);
    unsigned char* inputBytes = reinterpret_cast<unsigned char*>(inputJBytes);

    if (inputLength < 36) {
        env->ReleaseByteArrayElements(inputJavaArray, inputJBytes, 0);
        throwRuntimeException(env, "Error while decoding with compresso: Expected at least 36 bytes of input for the compresso header, got " + std::to_string(inputLength));
        return nullptr;
    }

    size_t outputLength = readOutputLengthFromHeader(inputBytes);

    if (outputLength <= 0) {
        env->ReleaseByteArrayElements(inputJavaArray, inputJBytes, 0);
        throwRuntimeException(env, "Error while decoding with compresso: output length as read from header must be >0, got " + std::to_string(outputLength));
        return nullptr;
    }

    unsigned char* outputBytes = static_cast<unsigned char*>(malloc(outputLength));

    int errorCode = compresso::decompress<void,void>(inputBytes, inputLength, outputBytes);

    if (errorCode != 0) {
        env->ReleaseByteArrayElements(inputJavaArray, inputJBytes, 0);
        throwRuntimeException(env, "Error while decoding with compresso: " + std::to_string(errorCode));
        return nullptr;
    }

    jbyteArray outputJavaArray = env->NewByteArray(outputLength);
    jbyte *outputJBytes = env->GetByteArrayElements(outputJavaArray, nullptr);
    for (size_t i = 0; i < outputLength; ++i) {
        outputJBytes[i] = static_cast<jbyte>(outputBytes[i]);
    }

    free(outputBytes);
    env->ReleaseByteArrayElements(inputJavaArray, inputJBytes, 0);
    env->ReleaseByteArrayElements(outputJavaArray, outputJBytes, JNI_COMMIT);

    return outputJavaArray;
}
