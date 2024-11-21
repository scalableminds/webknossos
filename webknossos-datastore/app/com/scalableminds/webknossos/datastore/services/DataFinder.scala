package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer

trait DataFinder {
  private def getExactDataOffset(data: Array[Byte], bytesPerElement: Int): Vec3Int = {
    val bucketLength = DataLayer.bucketLength

    Iterator
      .tabulate(bucketLength, bucketLength, bucketLength) { (z, y, x) =>
        val scaledX = x * bytesPerElement
        val scaledY = y * bytesPerElement * bucketLength
        val scaledZ = z * bytesPerElement * bucketLength * bucketLength
        val voxelOffset = scaledX + scaledY + scaledZ
        (x, y, z, voxelOffset)
      }
      .flatten
      .flatten
      .collectFirst {
        case (x, y, z, voxelOffset) if data.slice(voxelOffset, voxelOffset + bytesPerElement).exists(_ != 0) =>
          Vec3Int(x, y, z)
      }
      .getOrElse(Vec3Int.zeros)
  }

  def getPositionOfNonZeroData(data: Array[Byte],
                               globalPositionOffset: Vec3Int,
                               bytesPerElement: Int): Option[Vec3Int] =
    if (data.nonEmpty && data.exists(_ != 0)) Some(globalPositionOffset.move(getExactDataOffset(data, bytesPerElement)))
    else None
}
