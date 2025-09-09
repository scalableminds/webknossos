#include "com_scalableminds_webknossos_datastore_services_mcubes_NativeMarchingCubes.h"

JNIEXPORT jfloatArray JNICALL Java_com_scalableminds_webknossos_datastore_services_mcubes_NativeMarchingCubes_marchingCubes(
    JNIEnv *env,
    jobject instance,
    jbyteArray inputJavaArray,
    jint bytesPerElement,
    jboolean isSigned,
    jlong segmentId,
    jint dataDimensionsX,
    jint dataDimensionsY,
    jint dataDimensionsZ,
    jfloat offsetX,
    jfloat offsetY,
    jfloat offsetZ,
    jfloat scaleX,
    jfloat scaleY,
    jfloat scaleZ,
    jint topLeftX,
    jint topLeftY,
    jint topLeftZ,
    jint bottomRightX,
    jint bottomRightY,
    jint bottomRightZ
    ) {
    jsize inputLength = env->GetArrayLength(inputJavaArray);
    jbyte *dataAsJByte = env->GetByteArrayElements(inputJavaArray, NULL);
    const char *inputBytes = reinterpret_cast<const char *>(dataAsJByte);


    jfloatArray result = env->NewFloatArray(5);
    // env->SetByteArrayRegion(result, 0, outputLength, reinterpret_cast<const jbyte *>(encodeBuffer.data()));
    env->ReleaseByteArrayElements(inputJavaArray, dataAsJByte, 0);
    return result;
  }
