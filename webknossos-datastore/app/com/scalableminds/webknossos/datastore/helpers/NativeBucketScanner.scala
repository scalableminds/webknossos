package com.scalableminds.webknossos.datastore.helpers

import com.github.sbt.jni.nativeLoader

@nativeLoader("webknossosJni0")
class NativeBucketScanner() {
  @native def collectSegmentIds(bucketBytes: Array[Byte], bytesPerElement: Int, isSigned: Boolean): Array[Long]
}
