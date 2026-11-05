package com.scalableminds.webknossos.datastore.helpers

import java.nio.file.Files

/** Loads the native libraries that implement the `@native` methods of NativeBucketScanner, NativeCompressoCompressor
  * and NativeDracoToStlConverter. The JVM binds each native method to whichever loaded library exports its symbol:
  *   - webknossosNative0: Rust, built from webknossos-native
  *   - webknossosJni0: C++, built from webknossos-jni, whose functions are being moved to webknossosNative0
  *
  * The libraries are loaded from this object, i.e. from the application classloader. Loading them via sbt-jni's
  * NativeLoader would happen from the sbt-jni-core classloader (parent), and JNI could then not resolve the native
  * methods declared on the classes above.
  */
object NativeLibraries {
  private val libraryNames = Seq("webknossosNative0", "webknossosJni0")

  libraryNames.foreach { libraryName =>
    try System.loadLibrary(libraryName)
    catch {
      case _: UnsatisfiedLinkError =>
        System.load(extractFromClasspath(libraryName))
    }
  }

  // Calling this initializes the object, which loads the libraries once.
  def ensureLoaded(): Unit = ()

  // sbt-jni packages the libraries as resources at /native/<arch>-<os>/
  private def extractFromClasspath(libraryName: String): String = {
    val lib = System.mapLibraryName(libraryName)
    val uname = scala.sys.process.Process("uname -sm").!!.trim.split(" ")
    val plat = uname(1).toLowerCase + "-" + uname(0).toLowerCase
    val resourcePath = s"/native/$plat/$lib"
    val stream = getClass.getResourceAsStream(resourcePath)
    if (stream == null)
      throw new UnsatisfiedLinkError(s"Native library $lib ($resourcePath) cannot be found on the classpath.")
    val tmp = Files.createTempDirectory("jni-")
    val extracted = tmp.resolve(lib)
    Files.copy(stream, extracted)
    extracted.toAbsolutePath.toString
  }
}
