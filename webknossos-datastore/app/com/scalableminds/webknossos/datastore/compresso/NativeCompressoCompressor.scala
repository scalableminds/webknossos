package com.scalableminds.webknossos.datastore.compresso

import com.github.sbt.jni.nativeLoader

@nativeLoader("webknossosJni0")
class NativeCompressoCompressor {
  @native def decompress(bytes: Array[Byte]): Array[Byte]
}
