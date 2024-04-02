package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer

trait DataFinder {
  private def getExactDataOffset(data: Array[Byte], bytesPerElement: Int): Vec3Int = {
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
      if (data.slice(voxelOffset, voxelOffset + bytesPerElement).exists(_ != 0)) return Vec3Int(x, y, z)
    }
    Vec3Int.zeros
  }

  def getPositionOfNonZeroData(data: Array[Byte],
                               globalPositionOffset: Vec3Int,
                               bytesPerElement: Int): Option[Vec3Int] =
    if (data.nonEmpty && data.exists(_ != 0)) Some(globalPositionOffset.move(getExactDataOffset(data, bytesPerElement)))
    else None
}
