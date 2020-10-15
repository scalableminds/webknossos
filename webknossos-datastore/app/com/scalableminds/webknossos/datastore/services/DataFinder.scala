package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer

trait DataFinder {
  private def getExactDataOffset(data: Array[Byte], bytesPerElement: Int): Point3D = {
    val bucketLength = DataLayer.bucketLength
    for {
      z <- 0 until bucketLength
      y <- 0 until bucketLength
      x <- 0 until bucketLength
      scaledX = x * bytesPerElement
      scaledY = y * bytesPerElement * bucketLength
      scaledZ = z * bytesPerElement * bucketLength * bucketLength
    } {
      val voxelOffset = scaledX + scaledY + scaledZ
      if (data.slice(voxelOffset, voxelOffset + bytesPerElement).exists(_ != 0)) return Point3D(x, y, z)
    }
    Point3D(0, 0, 0)
  }

  def getPositionOfNonZeroData(data: Array[Byte],
                               globalPositionOffset: Point3D,
                               bytesPerElement: Int): Option[Point3D] =
    if (data.nonEmpty && data.exists(_ != 0)) Some(globalPositionOffset.move(getExactDataOffset(data, bytesPerElement)))
    else None
}
