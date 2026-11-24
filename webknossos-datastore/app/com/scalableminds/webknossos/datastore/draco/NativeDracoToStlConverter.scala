package com.scalableminds.webknossos.datastore.draco

import com.scalableminds.webknossos.datastore.helpers.NativeLibrary

class NativeDracoToStlConverter {
  NativeLibrary.ensureLoaded()

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
