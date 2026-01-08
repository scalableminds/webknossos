package com.scalableminds.webknossos.datastore.helpers

import com.github.sbt.jni.nativeLoader

@nativeLoader("webknossosJni0")
class NativeBucketScanner() {
  @native def collectSegmentIds(bucketBytes: Array[Byte],
                                bytesPerElement: Int,
                                isSigned: Boolean,
                                skipZeroes: Boolean): Array[Long]

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

  @native def mergeVolumeBucketInPlace(bucketBytesMutable: Array[Byte],
                                       incomingBucketBytes: Array[Byte],
                                       skipMapping: Boolean,
                                       idMappingSrc: Array[Long],
                                       idMappingDst: Array[Long],
                                       bytesPerElement: Int,
                                       elementsAreSigned: Boolean): Unit

  @native def deleteSegmentFromBucket(bucketBytes: Array[Byte],
                                      bytesPerElement: Int,
                                      isSigned: Boolean,
                                      segmentId: Long): Array[Byte]

}
