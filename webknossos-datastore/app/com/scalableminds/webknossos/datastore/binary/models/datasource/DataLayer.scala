/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.binary.models.datasource

import com.scalableminds.webknossos.datastore.binary.dataformats.{BucketProvider, MappingProvider}
import com.scalableminds.webknossos.datastore.binary.dataformats.knossos.{KnossosDataLayer, KnossosSegmentationLayer}
import com.scalableminds.webknossos.datastore.binary.dataformats.wkw.{WKWDataLayer, WKWSegmentationLayer}
import com.scalableminds.webknossos.datastore.binary.models.BucketPosition
import com.scalableminds.util.geometry.BoundingBox
import play.api.libs.json._

object DataFormat extends Enumeration {

  val knossos, wkw, tracing = Value

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

  def maxValue(elementClass: ElementClass.Value): Long = 1L << (elementClass.id * 8L)
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
      case layer: SegmentationLayerLike => AbstractSegmentationLayer.abstractSegmentationLayerFormat.writes(AbstractSegmentationLayer.from(layer))
      case _ => AbstractDataLayer.abstractDataLayerFormat.writes(AbstractDataLayer.from(layer))
    }
  }
}

trait SegmentationLayerLike extends DataLayerLike {

  def largestSegmentId: Long

  def mappings: Set[String]
}

trait DataLayer extends DataLayerLike {

  def dataFormat: DataFormat.Value

  /**
    * Defines the length of the underlying cubes making up the layer. This is the maximal size that can be loaded from a single file.
    */
  def lengthOfUnderlyingCubes(resolution: Int): Int

  def bucketProvider: BucketProvider

  def doesContainBucket(bucket: BucketPosition) =
    boundingBox.intersects(bucket.toHighestResBoundingBox)

  lazy val bytesPerElement =
    ElementClass.bytesPerElement(elementClass)
}

object DataLayer {

  /**
    * Defines the length of a buckets. This is the minimal size that can be loaded from a file.
    */
  val bucketLength: Int = 32

  implicit object dataLayerFormat extends Format[DataLayer] {
    override def reads(json: JsValue): JsResult[DataLayer] = {
      for {
        dataFormat <- json.validate((JsPath \ "dataFormat").read[DataFormat.Value])
        category <- json.validate((JsPath \ "category").read[Category.Value])
        layer <- (dataFormat, category) match {
          case (DataFormat.knossos, Category.segmentation) => json.validate[KnossosSegmentationLayer]
          case (DataFormat.knossos, _) => json.validate[KnossosDataLayer]
          case (DataFormat.wkw, Category.segmentation) => json.validate[WKWSegmentationLayer]
          case (DataFormat.wkw, _) => json.validate[WKWDataLayer]
        }
      } yield {
        layer
      }
    }

    override def writes(layer: DataLayer): JsValue = {
      (layer match {
        case l: KnossosDataLayer => KnossosDataLayer.knossosDataLayerFormat.writes(l)
        case l: KnossosSegmentationLayer => KnossosSegmentationLayer.knossosSegmentationLayerFormat.writes(l)
        case l: WKWDataLayer => WKWDataLayer.wkwDataLayerFormat.writes(l)
        case l: WKWSegmentationLayer => WKWSegmentationLayer.wkwSegmentationLayerFormat.writes(l)
      }).as[JsObject] ++ Json.obj(
        "category" -> layer.category,
        "dataFormat" -> layer.dataFormat
      )
    }
  }
}

trait SegmentationLayer extends DataLayer with SegmentationLayerLike {

  val category = Category.segmentation

  lazy val mappingProvider: MappingProvider = new MappingProvider(this)
}

object SegmentationLayer {
  val defaultLargestSegmentId = 0
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
                                      mappings: Set[String]
                                    ) extends SegmentationLayerLike

object AbstractSegmentationLayer {

  def from(layer: SegmentationLayerLike): AbstractSegmentationLayer = {
    AbstractSegmentationLayer(layer.name, layer.category, layer.boundingBox, layer.resolutions, layer.elementClass, layer.largestSegmentId, layer.mappings)
  }

  implicit val abstractSegmentationLayerFormat = Json.format[AbstractSegmentationLayer]
}
