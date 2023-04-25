package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import ArrayDataType.{ArrayDataType, bytesPerElementFor}

import java.nio.ByteOrder

trait DatasetHeader {
  def datasetShape: Array[Int] // shape of the entire array

  def chunkSize: Array[Int] // shape of each chunk

  def dimension_separator: DimensionSeparator

  def dataType: String

  def fill_value: Either[String, Number]

  def order: ArrayOrder

  def resolvedDataType: ArrayDataType

  def compressorImpl: Compressor

  lazy val byteOrder: ByteOrder = ByteOrder.BIG_ENDIAN

  lazy val bytesPerElement: Int = bytesPerElementFor(resolvedDataType)

  lazy val bytesPerChunk: Int = chunkSize.toList.product * bytesPerElement

  lazy val fillValueNumber: Number =
    fill_value match {
      case Right(n) => n
      case Left(_)  => 0 // parsing fill value from string not currently supported
    }

  def boundingBox(axisOrder: AxisOrder): Option[BoundingBox] =
    if (Math.max(Math.max(axisOrder.x, axisOrder.y), axisOrder.z) >= rank)
      None
    else
      Some(BoundingBox(Vec3Int.zeros, datasetShape(axisOrder.x), datasetShape(axisOrder.y), datasetShape(axisOrder.z)))

  lazy val rank: Int = datasetShape.length

  def chunkSizeAtIndex(chunkIndex: Array[Int]): Array[Int] = chunkSize

  def isSharded = false

  def voxelOffset: Array[Int]
}
