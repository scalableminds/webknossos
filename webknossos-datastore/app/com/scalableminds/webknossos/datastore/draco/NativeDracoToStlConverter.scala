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

  /** The total area of the faces of the Draco mesh, transformed like by [[dracoToStl]], computed in double precision
    * (webknossos-native/src/draco.rs).
    */
  @native def dracoSurfaceArea(
      a: Array[Byte],
      offsetX: Float,
      offsetY: Float,
      offsetZ: Float,
      scaleX: Double,
      scaleY: Double,
      scaleZ: Double,
      vertexQuantizationBits: Int
  ): Double

}
