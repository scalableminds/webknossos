/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models.datasource

import com.scalableminds.braingames.binary.dataformats.CubeLoader
import com.scalableminds.braingames.binary.dataformats.knossos.{KnossosDataLayer, KnossosSegmentationLayer}
import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.util.geometry.BoundingBox
import play.api.libs.json._

object DataFormat extends Enumeration {

  val knossos, wkw = Value

  implicit val dataLayerFormatFormat = Format(Reads.enumNameReads(DataFormat), Writes.enumNameWrites)
}

object Category extends Enumeration {

  val color, mask, segmentation = Value

  implicit val categoryFormat = Format(Reads.enumNameReads(Category), Writes.enumNameWrites)

  def fromElementClass(elementClass: ElementClass.Value): Category.Value = {
    elementClass match {
      case ElementClass.uint8  => color
      case ElementClass.uint16 => segmentation
      case ElementClass.uint24 => color
      case ElementClass.uint32 => segmentation
      case ElementClass.uint64 => segmentation
    }
  }
}

object ElementClass extends Enumeration {

  val uint8 = Value(1)
  val uint16 = Value(2)
  val uint24 = Value(3)
  val uint32 = Value(4)
  val uint64 = Value(8)

  implicit val dataLayerElementClassFormat = Format(Reads.enumNameReads(ElementClass), Writes.enumNameWrites)

  def bytesPerElement(elementClass: ElementClass.Value): Int = elementClass.id

  def fromBytesPerElement(bytesPerElement: Int): Option[ElementClass.Value] = values.find(_.id == bytesPerElement)
}

trait DataLayerLike {

  def name: String

  def category: Category.Value

  def boundingBox: BoundingBox

  def resolutions: List[Int]

  def elementClass: ElementClass.Value
}

object DataLayerLike {

  implicit object dataLayerLikeFormat extends Format[DataLayerLike] {
    override def reads(json: JsValue): JsResult[DataLayerLike] =
      AbstractSegmentationLayer.abstractSegmentationLayerFormat.reads(json)
        .orElse(AbstractDataLayer.abstractDataLayerFormat.reads(json))

    override def writes(layer: DataLayerLike): JsValue = layer match {
      case layer: SegmentationLayerLike => Json.toJson(AbstractSegmentationLayer.from(layer))
      case _ => Json.toJson(AbstractDataLayer.from(layer))
    }
  }
}

trait SegmentationLayerLike extends DataLayerLike {

  def largestSegmentId: Long

  def mappings: List[String]
}

trait DataLayer extends DataLayerLike {

  def dataFormat: DataFormat.Value

  /**
    * Defines the length of the buckets loaded from files. This is the minimal size that can be loaded from a file.
    */
  def lengthOfProvidedBuckets: Int = 32

  /**
    * Defines the length of the underlying cubes making up the layer. This is the maximal size that can be loaded from a single file.
    */
  def lengthOfUnderlyingCubes: Int

  def cubeLoader: CubeLoader

  def doesContainBucket(bucket: BucketPosition) =
    boundingBox.contains(bucket.topLeft.toHighestRes)

  val bytesPerElement =
    ElementClass.bytesPerElement(elementClass)
}

object DataLayer {

  implicit object dataLayerFormat extends Format[DataLayer] {
    override def reads(json: JsValue): JsResult[DataLayer] = {
      for {
        dataFormat <- json.validate((JsPath \ "dataFormat").read[DataFormat.Value])
        category <- json.validate((JsPath \ "category").read[Category.Value])
        layer <- (dataFormat, category) match {
          case (DataFormat.knossos, Category.segmentation) => json.validate[KnossosSegmentationLayer]
          case (DataFormat.knossos, _) => json.validate[KnossosDataLayer]
          // case (DataFormat.wkw, Category.segmentation) => json.validate[WKWSegmentationLayer]
          // case (DataFormat.wkw, _) => json.validate[WkwDataLayer]
        }
      } yield {
        layer
      }
    }

    override def writes(layer: DataLayer): JsValue = {
      (layer match {
        case l: KnossosDataLayer => KnossosDataLayer.knossosDataLayerFormat.writes(l)
        case l: KnossosSegmentationLayer => KnossosSegmentationLayer.knossosSegmentationDataLayerFormat.writes(l)
      }).as[JsObject] ++ Json.obj(
        "category" -> layer.category,
        "dataFormat" -> layer.dataFormat
      )
    }
  }
}

trait SegmentationLayer extends DataLayer with SegmentationLayerLike {

  final val category = Category.segmentation

  def mappingLoader: Int
}

object SegmentationLayer {
  val defaultLargestSegmentId = 1000000000
}

case class AbstractDataLayer(
                              name: String,
                              category: Category.Value,
                              boundingBox: BoundingBox,
                              resolutions: List[Int],
                              elementClass: ElementClass.Value
                            ) extends DataLayerLike

object AbstractDataLayer {

  def from(layer: DataLayerLike): AbstractDataLayer = {
    AbstractDataLayer(layer.name, layer.category, layer.boundingBox, layer.resolutions, layer.elementClass)
  }

  implicit val abstractDataLayerFormat = Json.format[AbstractDataLayer]
}

case class AbstractSegmentationLayer(
                                      name: String,
                                      category: Category.Value,
                                      boundingBox: BoundingBox,
                                      resolutions: List[Int],
                                      elementClass: ElementClass.Value,
                                      largestSegmentId: Long,
                                      mappings: List[String]
                                    ) extends SegmentationLayerLike

object AbstractSegmentationLayer {

  def from(layer: SegmentationLayerLike): AbstractSegmentationLayer = {
    AbstractSegmentationLayer(layer.name, layer.category, layer.boundingBox, layer.resolutions, layer.elementClass, layer.largestSegmentId, layer.mappings)
  }

  implicit val abstractSegmentationLayerFormat = Json.format[AbstractSegmentationLayer]
}

















// TODO remove
case class UserDataLayer(dataSourceName: String, dataLayer: DataLayer)

object UserDataLayer {
  implicit val userDataLayerFormat = Json.format[UserDataLayer]
}
