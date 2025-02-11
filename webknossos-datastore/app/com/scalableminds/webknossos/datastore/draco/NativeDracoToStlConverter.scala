package com.scalableminds.webknossos.datastore.draco

// to make the code below work the core project should be included as a dependency via
// sbtJniCoreScope := Compile
import com.github.sbt.jni.syntax.NativeLoader

class NativeDracoToStlConverter() extends NativeLoader("webknossosJni0") {
  @native def dracoToStl(
      a: Array[Byte],
      offsetX: Float,
      offsetY: Float,
      offsetZ: Float,
      scaleX: Double,
      scaleY: Double,
      scaleZ: Double
  ): Array[Byte]
}
