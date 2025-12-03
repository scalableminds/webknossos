#include "com_scalableminds_webknossos_datastore_compresso_NativeCompressoCompressor.h"

#include "compresso.hpp"

JNIEXPORT jbyteArray JNICALL Java_com_scalableminds_webknossos_datastore_compresso_NativeCompressoCompressor_decompress
    (JNIEnv *env, jobject instance, jbyteArray inputJavaArray) {

    const jsize inputLengthBytes = env->GetArrayLength(inputJavaArray);
    jbyte *inputBytes = env->GetByteArrayElements(inputJavaArray, nullptr);

    unsigned char* inputBytesCharArray = reinterpret_cast<unsigned char*>(inputBytes);

    void* out = nullptr;

    int err = compresso::decompress<void,void>(inputBytesCharArray, inputLengthBytes, out);

    return nullptr;
}
