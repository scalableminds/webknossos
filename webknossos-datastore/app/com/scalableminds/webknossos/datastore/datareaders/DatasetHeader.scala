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
      case Left(s)  => parseFillValueFromString(s)
    }

  def boundingBox(axisOrder: AxisOrder): Option[BoundingBox] =
    if (Math.max(Math.max(axisOrder.x, axisOrder.y), axisOrder.z) >= rank)
      None
    else
      Some(
        BoundingBox(Vec3Int.zeros,
                    datasetShape(axisOrder.x),
                    datasetShape(axisOrder.y),
                    if (axisOrder.hasZAxis) datasetShape(axisOrder.z) else 1))

  lazy val rank: Int = datasetShape.length

  def chunkSizeAtIndex(chunkIndex: Array[Int]): Array[Int] = chunkSize

  def isSharded = false

  private def parseFillValueFromString(s: String): Number =
    s match {
      case "NaN"       => 0
      case "Infinity"  => ArrayDataType.maxValue(resolvedDataType)
      case "-Infinity" => ArrayDataType.minValue(resolvedDataType)
      case _           => 0 // Unsupported fill value does not throw exception
    }

  def voxelOffset: Array[Int]
}
