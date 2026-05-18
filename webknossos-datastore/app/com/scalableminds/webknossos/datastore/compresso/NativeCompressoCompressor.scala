package com.scalableminds.webknossos.datastore.compresso

import com.github.sbt.jni.syntax.NativeLoader

class NativeCompressoCompressor extends NativeLoader("webknossosJni0") {
  @native def decompress(bytes: Array[Byte]): Array[Byte]
}
