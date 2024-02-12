package com.scalableminds.webknossos.datastore

import com.github.sbt.jni.nativeLoader

@nativeLoader("webknossosNative0")
class NativeDracoToStlConverter() {
  @native def dracoToStl(a: Array[Byte], offsetX: Float, offsetY: Float, offsetZ: Float): Array[Byte]
}
