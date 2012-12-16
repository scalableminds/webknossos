package models.binary

import brainflight.tools.geometry.Point3D
import brainflight.tools.geometry.Vector3D
import brainflight.tools.Interpolator
import scala.collection.mutable.ArrayBuffer

sealed trait DataLayer {
  val folder: String
  val elementSize: Int
  val supportedResolutions: List[Int]
  def bytesPerElement = elementSize / 8

  def interpolate(
    resolution: Int,
    blockMap: Map[Point3D, Array[Byte]],
    byteLoader: (Point3D, Int, Int, Map[Point3D, Array[Byte]]) => ArrayBuffer[Byte])(point: Vector3D): ArrayBuffer[Byte]
}

case class ColorLayer(elementSize: Int = 8, supportedResolutions: List[Int] = List(1)) extends DataLayer with TrilerpInterpolation {
  val folder = ColorLayer.identifier
}
case class ClassificationLayer(elementSize: Int = 8, supportedResolutions: List[Int] = List(1), order: List[String]) extends DataLayer with NearestNeighborInterpolation {
  val folder = ClassificationLayer.identifier
}
case class SegmentationLayer(elementSize: Int = 8, supportedResolutions: List[Int] = List(1)) extends DataLayer with NearestNeighborInterpolation {
  val folder = SegmentationLayer.identifier
}

object ColorLayer {
  val default = ColorLayer(8, List(1))
  def identifier = "color"
}

object ClassificationLayer {
  val default = ClassificationLayer(8, List(1), List("mito"))
  def identifier = "classification"

}

object SegmentationLayer {
  val default = SegmentationLayer(16, List(1))
  def identifier = "segmentation"
}