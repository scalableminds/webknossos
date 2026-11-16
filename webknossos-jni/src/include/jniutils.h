#pragma once

#include <jni.h>
#include <string>

void throwRuntimeException(JNIEnv *, const std::string);
