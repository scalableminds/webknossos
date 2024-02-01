package com.scalableminds.webknossos.datastore.draco

import com.github.sbt.jni.nativeLoader

@nativeLoader("webknossosNative0")
class NativeDracoDecoder() {
  @native def decode(a: Array[Byte]): Array[Byte]
}
