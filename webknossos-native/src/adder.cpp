#include "com_scalableminds_webknossos_datastore_NativeAdder.h"

JNIEXPORT jint JNICALL Java_com_scalableminds_webknossos_datastore_NativeAdder_add
  (JNIEnv* env, jobject instance, jint a, jint b)
{
	return a + b;
}

