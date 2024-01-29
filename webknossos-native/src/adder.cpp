#include "com_scalableminds_webknossos_datastore_NativeAdder.h"

JNIEXPORT jint JNICALL Java_com_scalableminds_webknossos_datastore_NativeAdder_plus
  (JNIEnv* env, jobject instance, jint term)
{
	jclass clazz = (*env)->GetObjectClass(env, instance);
	jfieldID field = (*env)->GetFieldID(env, clazz, "base", "I");
	jint base = (*env)->GetIntField(env, instance, field);
	return base + term;
}
