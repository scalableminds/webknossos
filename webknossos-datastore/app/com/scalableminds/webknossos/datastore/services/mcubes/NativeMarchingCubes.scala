package com.scalableminds.webknossos.datastore.services.mcubes

import com.github.sbt.jni.nativeLoader

@nativeLoader("webknossosJni0")
class NativeMarchingCubes {
  @native def marchingCubes(bucketBytes: Array[Byte],
                            bytesPerElement: Int,
                            isSigned: Boolean,
                            segmentId: Long,
                            dataDimensionsX: Int,
                            dataDimensionsY: Int,
                            dataDimensionsZ: Int,
                            offsetX: Float,
                            offsetY: Float,
                            offsetZ: Float,
                            scaleX: Float,
                            scaleY: Float,
                            scaleZ: Float,
                            topLeftX: Int,
                            topLeftY: Int,
                            topLeftZ: Int,
                            bottomRightX: Int,
                            bottomRightY: Int,
                            bottomRightZ: Int): Array[Float]
}
