package com.scalableminds.webknossos.datastore.helpers

import com.github.sbt.jni.nativeLoader

@nativeLoader("webknossosJni0")
class NativeBucketScanner() {
  @native def collectSegmentIds(bucketBytes: Array[Byte], bytesPerElement: Int, isSigned: Boolean): Array[Long]

  @native def countSegmentVoxels(bucketBytes: Array[Byte],
                                 bytesPerElement: Int,
                                 isSigned: Boolean,
                                 segmentId: Long): Long

  @native def extendSegmentBoundingBox(bucketBytes: Array[Byte],
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
                                       existingBBoxBottomRightZ: Int): Array[Int]
}
