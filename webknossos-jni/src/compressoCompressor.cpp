#include "com_scalableminds_webknossos_datastore_compresso_NativeCompressoCompressor.h"

#include "jniutils.h"
#include "compresso.hpp"
#include<string>

uint16_t combineUint16LittleEndian(uint8_t lower, uint8_t higher) {
    uint16_t combined = static_cast<uint16_t>(lower);
    combined |= static_cast<uint16_t>(higher) << 8;
    return combined;
}

size_t readOutputLengthFromHeader(unsigned char* inputBytesCharArray) {
    unsigned char dataWidth = inputBytesCharArray[5];
    uint16_t sizeX = combineUint16LittleEndian(inputBytesCharArray[6], inputBytesCharArray[7]);
    uint16_t sizeY = combineUint16LittleEndian(inputBytesCharArray[8], inputBytesCharArray[9]);
    uint16_t sizeZ = combineUint16LittleEndian(inputBytesCharArray[10], inputBytesCharArray[11]);

    return static_cast<size_t>(dataWidth) * static_cast<size_t>(sizeX) * static_cast<size_t>(sizeY) * static_cast<size_t>(sizeZ);
}

JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_compresso_NativeCompressoCompressor_decompress
    (JNIEnv *env, jobject instance, jbyteArray inputJavaArray) {

    const size_t inputLengthBytes = static_cast<size_t>(env->GetArrayLength(inputJavaArray));
    jbyte *inputBytes = env->GetByteArrayElements(inputJavaArray, nullptr);

    unsigned char* inputBytesCharArray = reinterpret_cast<unsigned char*>(inputBytes);

    size_t outputLength = readOutputLengthFromHeader(inputBytesCharArray);

    unsigned char* outputBuffer = static_cast<unsigned char*>(malloc(outputLength));

    int errorCode = compresso::decompress<void,void>(inputBytesCharArray, inputLengthBytes, outputBuffer);

    if (errorCode != 0) {
        env->ReleaseByteArrayElements(inputJavaArray, inputBytes, 0);
        throwRuntimeException(env, "Error while decoding with compresso: " + std::to_string(errorCode));
        return nullptr;
    }

    jbyteArray target = env->NewByteArray(outputLength);
    jbyte *targetElements = env->GetByteArrayElements(target, nullptr);

    for (size_t i = 0; i < outputLength; ++i) {
        targetElements[i] = static_cast<jbyte>(outputBuffer[i]);
    }
    free(outputBuffer);
    env->ReleaseByteArrayElements(target, targetElements, JNI_COMMIT);
    env->ReleaseByteArrayElements(inputJavaArray, inputBytes, 0);

    return target;
}
