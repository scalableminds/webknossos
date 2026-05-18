package com.scalableminds.webknossos.datastore.helpers

import com.github.sbt.jni.syntax.NativeLoader
import com.scalableminds.webknossos.datastore.helpers.NativeBucketScanner.getClass

import java.nio.file.Files

object NativeLoaderUtils {
  def prepare(libName: String): String = {
    val lib = System.mapLibraryName(libName)
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

// Load the native library from this class's classloader (application classloader).
// Extending NativeLoader directly causes the load to happen from the sbt-jni-core classloader
// (parent), so JNI cannot resolve native methods declared on NativeBucketScanner (child).
object NativeBucketScanner {
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

class NativeBucketScanner {
  NativeBucketScanner.load // triggers companion object initialization and library load
  @native def collectSegmentIds(
      bucketBytes: Array[Byte],
      bytesPerElement: Int,
      isSigned: Boolean,
      skipZeroes: Boolean
  ): Array[Long]

  @native def countSegmentVoxels(
      bucketBytes: Array[Byte],
      bytesPerElement: Int,
      isSigned: Boolean,
      segmentId: Long
  ): Long

  @native def extendSegmentBoundingBox(
      bucketBytes: Array[Byte],
      bytesPerElement: Int,
      isSigned: Boolean,
      bucketLength: Int,
      segmentId: Long,
      bucketTopLeftX: Int,
      bucketTopLeftY: Int,
      bucketTopLeftZ: Int,
      existingBBoxTopLeftX: Int,
      existingBBoxTopLeftY: Int,
      existingBBoxTopLeftZ: Int,
      existingBBoxBottomRightX: Int,
      existingBBoxBottomRightY: Int,
      existingBBoxBottomRightZ: Int
  ): Array[Int]

  @native def applySegmentIdMapping(
      bucketBytes: Array[Byte],
      bytesPerElement: Int,
      isSigned: Boolean,
      idMappingSrc: Array[Long],
      idMappingDst: Array[Long]
  ): Array[Byte]

  @native def mergeVolumeBucketInPlace(
      bucketBytesMutable: Array[Byte],
      incomingBucketBytes: Array[Byte],
      skipMapping: Boolean,
      idMappingSrc: Array[Long],
      idMappingDst: Array[Long],
      bytesPerElement: Int,
      isSigned: Boolean
  ): Unit

  @native def deleteSegmentFromBucket(
      bucketBytes: Array[Byte],
      bytesPerElement: Int,
      isSigned: Boolean,
      segmentId: Long
  ): Array[Byte]

}
