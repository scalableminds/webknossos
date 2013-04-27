package models.binary

import brainflight.tools.geometry.Point3D
import brainflight.tools.geometry.Vector3D
import brainflight.tools.Interpolator
import scala.collection.mutable.ArrayBuffer
import play.api.libs.json._
import play.api.libs.functional.syntax._

trait TrilerpInterpolation {

  def getColor(
    byteLoader: (Point3D, Int, Int, Map[Point3D, Array[Byte]]) => Array[Byte],
    resolution: Int,
    blockMap: Map[Point3D, Array[Byte]])(point: Point3D): Double = {

    val color = byteLoader(point, 1, resolution, blockMap)(0)
    (0xff & color.asInstanceOf[Int])
  }

  def interpolate(
    resolution: Int,
    blockMap: Map[Point3D, Array[Byte]],
    byteLoader: (Point3D, Int, Int, Map[Point3D, Array[Byte]]) => Array[Byte])(point: Vector3D): Array[Byte] = {

    val colorF = getColor(byteLoader, resolution, blockMap) _
    val x = point.x.toInt
    val y = point.y.toInt
    val z = point.z.toInt

    if (point.x == x && point.y == y & point.z == z) {
      Array(colorF(Point3D(x, y, z)).toByte)
    } else {
      val floored = Vector3D(x, y, z)
      val q = Array(
        colorF(Point3D(x, y, z)),
        colorF(Point3D(x, y, z + 1)),
        colorF(Point3D(x, y + 1, z)),
        colorF(Point3D(x, y + 1, z + 1)),
        colorF(Point3D(x + 1, y, z)),
        colorF(Point3D(x + 1, y, z + 1)),
        colorF(Point3D(x + 1, y + 1, z)),
        colorF(Point3D(x + 1, y + 1, z + 1)))

      Array(Interpolator.triLerp(point - floored, q).round.toByte)
    }
  }
}

trait NearestNeighborInterpolation {
  def bytesPerElement: Int

  def interpolate(
    resolution: Int,
    blockMap: Map[Point3D, Array[Byte]],
    byteLoader: (Point3D, Int, Int, Map[Point3D, Array[Byte]]) => Array[Byte])(point: Vector3D): Array[Byte] = {
    
    val byte = point.x % bytesPerElement
    val x = (point.x - byte + (if (bytesPerElement - 2 * byte >= 0) 0 else bytesPerElement)).toInt
    byteLoader(Point3D(x, point.y.round.toInt, point.z.round.toInt), bytesPerElement, resolution, blockMap)
  }
}

sealed trait DataLayer{
  val baseDir: String
  val name: String
  val elementClass: String

  val supportedResolutions: List[Int]
  val elementSize = elementClassToSize(elementClass)
  val bytesPerElement = elementSize / 8

  def elementClassToSize(elementClass: String): Int = elementClass match {
    case "uint8" => 8
    case "uint16" => 16
    case "uint32" => 32
    case "uint64" => 64
    case _ => throw new IllegalArgumentException(s"illegal element class ($elementClass) for DataLayer")
  }
  
  def interpolate(
    resolution: Int,
    blockMap: Map[Point3D, Array[Byte]],
    byteLoader: (Point3D, Int, Int, Map[Point3D, Array[Byte]]) => Array[Byte])(point: Vector3D): Array[Byte]
}

trait DataLayerJsonFormat {
  
  def dataLayerUnapply(layer: DataLayer) = (layer.bytesPerElement, layer.supportedResolutions)
  
  def dataLayerReadsBuilder = (
    (__ \ "class").read[String] and
    (__ \ "resolutions").read[List[Int]]
  )
  
  def dataLayerWritesBuilder = (
    (__ \ "bytesPerElement").write[Int] and 
    (__ \ "supportedResolutions").write[List[Int]]     
  )
  
}

case class ColorLayer( elementClass: String = "uint8", supportedResolutions: List[Int]) extends DataLayer with TrilerpInterpolation {
  val name = "color"
  val baseDir = name
}
case class ClassificationLayer( elementClass: String = "uint8", supportedResolutions: List[Int], flags: List[String]) extends DataLayer with NearestNeighborInterpolation {
  val name = "classification"
  val baseDir = name
}
case class SegmentationLayer(batchId: Int, elementClass: String = "uint8", supportedResolutions: List[Int]) extends DataLayer with NearestNeighborInterpolation {
  val name = s"segmentation$batchId"
  val baseDir = s"segmentations/layer$batchId"
}

case class ContextFreeSegmentationLayer(elementClass: String = "uint8", supportedResolutions: List[Int]) {
  def addContext(batchId: Int) = SegmentationLayer(batchId, elementClass, supportedResolutions)
}

object ContextFreeSegmentationLayer extends DataLayerJsonFormat {
  implicit val ContextFreeSegmentationLayerReads: Reads[ContextFreeSegmentationLayer] = dataLayerReadsBuilder(ContextFreeSegmentationLayer.apply _)
}

object ColorLayer extends DataLayerJsonFormat{
  implicit val ColorLayerReads: Reads[ColorLayer] = dataLayerReadsBuilder(ColorLayer.apply _)
  implicit val ColorLayerWrites: Writes[ColorLayer] = dataLayerWritesBuilder(dataLayerUnapply _)
}

object ClassificationLayer extends DataLayerJsonFormat {
  
  def classificationLayerUnapply(layer: ClassificationLayer) = {
    val genericDataLayer = dataLayerUnapply(layer)
    (genericDataLayer._1, genericDataLayer._2, layer.flags)
  }
  
  implicit val ClassificationLayerReads: Reads[ClassificationLayer] = (
    dataLayerReadsBuilder and 
    (__ \ "flags").read[List[String]]
  )(ClassificationLayer.apply _)
  
  implicit val ClassificationLayerWrites: Writes[ClassificationLayer] = (
    dataLayerWritesBuilder and 
    (__ \ "flags").write[List[String]]
  )(classificationLayerUnapply _)
}


