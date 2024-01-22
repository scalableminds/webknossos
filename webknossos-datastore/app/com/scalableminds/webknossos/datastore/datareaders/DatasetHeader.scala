package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import ArrayDataType.{ArrayDataType, bytesPerElementFor}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass

import java.nio.ByteOrder

trait DatasetHeader {

  // Note that in DatasetArray, datasetShape and chunkShape are adapted for 2d datasets
  def datasetShape: Option[Array[Int]] // shape of the entire array
  def chunkShape: Array[Int] // shape of each chunk,

  def dimension_separator: DimensionSeparator

  def fill_value: Either[String, Number]

  def order: ArrayOrder

  def resolvedDataType: ArrayDataType

  lazy val elementClass: Option[ElementClass.Value] = ElementClass.fromArrayDataType(resolvedDataType)

  def compressorImpl: Compressor

  lazy val byteOrder: ByteOrder = ByteOrder.BIG_ENDIAN

  lazy val bytesPerElement: Int = bytesPerElementFor(resolvedDataType)

  lazy val bytesPerChunk: Int = chunkShape.toList.product * bytesPerElement

  lazy val fillValueNumber: Number =
    fill_value match {
      case Right(n) => n
      case Left(s)  => parseFillValueFromString(s)
    }

  def boundingBox(axisOrder: AxisOrder): Option[BoundingBox] =
    datasetShape.flatMap { shape =>
      if (Math.max(Math.max(axisOrder.x, axisOrder.y), axisOrder.zWithFallback) >= rank && axisOrder.hasZAxis)
        None
      else {
        if (axisOrder.hasZAxis) {
          Some(BoundingBox(Vec3Int.zeros, shape(axisOrder.x), shape(axisOrder.y), shape(axisOrder.zWithFallback)))
        } else {
          Some(BoundingBox(Vec3Int.zeros, shape(axisOrder.x), shape(axisOrder.y), 1))
        }
      }
    }

  // Note that in DatasetArray, this is adapted for 2d datasets
  lazy val rank: Int = chunkShape.length

  def chunkShapeAtIndex(chunkIndex: Array[Int]): Array[Int] = chunkShape

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
