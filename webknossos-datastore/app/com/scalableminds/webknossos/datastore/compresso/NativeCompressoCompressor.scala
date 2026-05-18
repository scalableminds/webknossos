package com.scalableminds.webknossos.datastore.compresso

import com.scalableminds.webknossos.datastore.helpers.NativeLoaderUtils

// Load the native library from this class's classloader (application classloader).
// Extending NativeLoader directly causes the load to happen from the sbt-jni-core classloader
// (parent), so JNI cannot resolve native methods declared on the child class.
object NativeCompressoCompressor {
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

class NativeCompressoCompressor {
  NativeCompressoCompressor.load // triggers companion object initialization and library load
  @native def decompress(bytes: Array[Byte]): Array[Byte]
}
