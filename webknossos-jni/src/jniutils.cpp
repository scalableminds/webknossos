#include "jniutils.h"

void throwRuntimeException(JNIEnv * env, const std::string msg) {
    jclass exceptionClass = env -> FindClass("java/lang/RuntimeException");

    if (exceptionClass != nullptr) {
        env -> ThrowNew(exceptionClass, ("An error occurred in native code: " + msg).c_str());
    }
}
