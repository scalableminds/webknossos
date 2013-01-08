package models.binary

import brainflight.tools.geometry.Point3D
import brainflight.tools.geometry.Vector3D
import brainflight.tools.Interpolator
import scala.collection.mutable.ArrayBuffer
import play.api.libs.json._

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
  val folder: String
  val elementSize: Int
  val supportedResolutions: List[Int]
  def bytesPerElement = elementSize / 8

  def interpolate(
    resolution: Int,
    blockMap: Map[Point3D, Array[Byte]],
    byteLoader: (Point3D, Int, Int, Map[Point3D, Array[Byte]]) => Array[Byte])(point: Vector3D): Array[Byte]
}

trait DataLayerJsonFormat[T <: DataLayer] extends Format[T]{
  val BYTES_PER_ELEMENT="bytesPerElement"
  val SUPPORTED_RESOLUTIONS="supportedResolutions"
    
  def elementClassToBitCount(elementClass: String) = elementClass match {
    case "uint8" => 8
    case "uint16" => 16
    case "uint32" => 32
    case "uint64" => 64
    case _ => throw new IllegalArgumentException("illegal element class (%s) for DataLayer".format(elementClass))
  }
  
  def writes(dataLayer: T) = Json.obj(
      BYTES_PER_ELEMENT -> dataLayer.bytesPerElement,
      SUPPORTED_RESOLUTIONS -> Json.toJson(dataLayer.supportedResolutions)
  )
  
}

case class ColorLayer(elementSize: Int = 8, supportedResolutions: List[Int] = List(1)) extends DataLayer with TrilerpInterpolation {
  val folder = ColorLayer.identifier
}
case class ClassificationLayer(elementSize: Int = 8, supportedResolutions: List[Int] = List(1), flags: List[String]) extends DataLayer with NearestNeighborInterpolation {
  val folder = ClassificationLayer.identifier
}
case class SegmentationLayer(elementSize: Int = 8, supportedResolutions: List[Int] = List(1)) extends DataLayer with NearestNeighborInterpolation {
  val folder = SegmentationLayer.identifier
}

object ColorLayer {
  val default = ColorLayer(8, List(1))
  def identifier = "color"
   
  implicit object ColorLayerFormat extends DataLayerJsonFormat[ColorLayer] {
    def reads(js: JsValue) = 
      JsSuccess(ColorLayer(elementClassToBitCount((js \ "class").as[String])))
  }
}

object ClassificationLayer {
  val default = ClassificationLayer(8, List(1), List("mito"))
  def identifier = "classification"
    
  implicit object ClassificationLayerFormat extends DataLayerJsonFormat[ClassificationLayer] {
    val FLAGS = "flags"
    def reads(js: JsValue) = 
      JsSuccess(ClassificationLayer(elementClassToBitCount((js \ "class").as[String]), List(1), (js \ "flags").as[List[String]]))
    override def writes(layer: ClassificationLayer) = super.writes(layer).as[JsObject] ++ Json.obj(FLAGS -> Json.toJson(layer.flags))
  }
}

object SegmentationLayer{
  val default = SegmentationLayer(16, List(1))
  def identifier = "segmentation"
    
  implicit object SegmentationLayerFormat extends DataLayerJsonFormat[SegmentationLayer] {
    def reads(js: JsValue) = 
      JsSuccess(SegmentationLayer(elementClassToBitCount((js \ "class").as[String])))
  }
}