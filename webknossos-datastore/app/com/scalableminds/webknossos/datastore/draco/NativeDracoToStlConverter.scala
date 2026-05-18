package com.scalableminds.webknossos.datastore.draco

import com.github.sbt.jni.syntax.NativeLoader

class NativeDracoToStlConverter() extends NativeLoader("webknossosJni0") {
  @native def dracoToStl(
      a: Array[Byte],
      offsetX: Float,
      offsetY: Float,
      offsetZ: Float,
      scaleX: Double,
      scaleY: Double,
      scaleZ: Double,
      vertexQuantizationBits: Int
  ): Array[Byte]

}
