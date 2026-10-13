package com.scalableminds.webknossos.datastore.draco

import com.scalableminds.webknossos.datastore.helpers.NativeLoaderUtils

// Load the native library from this class's classloader (application classloader).
// JNI only resolves native methods of classes loaded by the classloader that loaded the library.
object NativeDracoToStlConverter {
  val load: Boolean = {
    val libName = "webknossosJni0"
    try
      System.loadLibrary(libName)
    catch {
      case _: UnsatisfiedLinkError =>
        System.load(NativeLoaderUtils.prepare(libName))
    }
    true
  }
}

class NativeDracoToStlConverter {
  NativeDracoToStlConverter.load // triggers companion object initialization and library load
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
