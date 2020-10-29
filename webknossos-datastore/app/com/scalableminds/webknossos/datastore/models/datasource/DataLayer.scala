package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.webknossos.datastore.dataformats.knossos.{KnossosDataLayer, KnossosSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataLayer, WKWSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, MappingProvider}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import play.api.libs.json._

object DataFormat extends Enumeration {

  val knossos, wkw, tracing = Value

  implicit val dataLayerFormatFormat = Format(Reads.enumNameReads(DataFormat), Writes.enumNameWrites)
}

object Category extends Enumeration {

  val color, mask, segmentation = Value

  implicit val categoryFormat = Format(Reads.enumNameReads(Category), Writes.enumNameWrites)

  def fromElementClass(elementClass: ElementClass.Value): Category.Value =
    elementClass match {
      case ElementClass.uint16 => segmentation
      case ElementClass.uint32 => segmentation
      case ElementClass.uint64 => segmentation
      case _                   => color
    }

  def fromString(s: String): Option[Value] = values.find(_.toString == s)
}

object ElementClass extends Enumeration {

  val uint8, uint16, uint24, uint32, uint64, float, double, int8, int16, int32, int64 = Value

  implicit val dataLayerElementClassFormat = Format(Reads.enumNameReads(ElementClass), Writes.enumNameWrites)

  def bytesPerElement(elementClass: ElementClass.Value): Int = elementClass match {
    case ElementClass.uint8  => 1
    case ElementClass.uint16 => 2
    case ElementClass.uint24 => 3
    case ElementClass.uint32 => 4
    case ElementClass.uint64 => 8
    case ElementClass.float  => 4
    case ElementClass.double => 8
    case ElementClass.int8   => 1
    case ElementClass.int16  => 2
    case ElementClass.int32  => 4
    case ElementClass.int64  => 8
  }

  /* ambiguous, we will always guess the unsigned integer options */
  def guessFromBytesPerElement(bytesPerElement: Int): Option[ElementClass.Value] = bytesPerElement match {
    case 1 => Some(ElementClass.uint8)
    case 2 => Some(ElementClass.uint16)
    case 3 => Some(ElementClass.uint24)
    case 4 => Some(ElementClass.uint32)
    case 8 => Some(ElementClass.uint64)
    case _ => None
  }

  /* only used for segmentation layers, so only unsigned integers 8 16 32 64 */
  def maxSegmentIdValue(elementClass: ElementClass.Value): Long = elementClass match {
    case ElementClass.uint8  => 1L << 8L
    case ElementClass.uint16 => 1L << 16L
    case ElementClass.uint32 => 1L << 32L
    case ElementClass.uint64 => (1L << 63L) - 1
  }

  def fromString(s: String): Option[Value] = values.find(_.toString == s)
}

object LayerViewConfiguration {
  type LayerViewConfiguration = Map[String, JsValue]

  implicit val layerViewConfigurationFormat = Format.of[LayerViewConfiguration]
}

trait DataLayerLike {

  def name: String

  def category: Category.Value

  def boundingBox: BoundingBox

  def resolutions: List[Point3D]

  def lookUpResolution(resolutionExponent: Int, snapToClosest: Boolean = false): Point3D = {
    val resPower = Math.pow(2, resolutionExponent).toInt
    val matchOpt = resolutions.find(resolution => resolution.maxDim == resPower)
    if (snapToClosest) matchOpt.getOrElse(resolutions.minBy(resolution => math.abs(resPower - resolution.maxDim)))
    else matchOpt.getOrElse(Point3D(resPower, resPower, resPower))
  }

  def elementClass: ElementClass.Value

  // This is the default from the DataSource JSON.
  def defaultViewConfiguration: Option[LayerViewConfiguration]

  // This is the default from the DataSet Edit View.
  def adminViewConfiguration: Option[LayerViewConfiguration]
}

object DataLayerLike {

  implicit object dataLayerLikeFormat extends Format[DataLayerLike] {
    override def reads(json: JsValue): JsResult[DataLayerLike] =
      AbstractSegmentationLayer.abstractSegmentationLayerFormat
        .reads(json)
        .orElse(AbstractDataLayer.abstractDataLayerFormat.reads(json))

    override def writes(layer: DataLayerLike): JsValue = layer match {
      case layer: SegmentationLayerLike =>
        AbstractSegmentationLayer.abstractSegmentationLayerFormat.writes(AbstractSegmentationLayer.from(layer))
      case _ => AbstractDataLayer.abstractDataLayerFormat.writes(AbstractDataLayer.from(layer))
    }
  }
}

trait SegmentationLayerLike extends DataLayerLike {

  def largestSegmentId: Long

  def mappings: Option[Set[String]]

  def defaultViewConfiguration: Option[LayerViewConfiguration]

  def adminViewConfiguration: Option[LayerViewConfiguration]
}

trait DataLayer extends DataLayerLike {

  def dataFormat: DataFormat.Value

  /**
    * Defines the length of the underlying cubes making up the layer. This is the maximal size that can be loaded from a single file.
    */
  def lengthOfUnderlyingCubes(resolution: Point3D): Int

  def bucketProvider: BucketProvider

  def containsResolution(resolution: Point3D) = resolutions.contains(resolution)

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
    override def reads(json: JsValue): JsResult[DataLayer] =
      for {
        dataFormat <- json.validate((JsPath \ "dataFormat").read[DataFormat.Value])
        category <- json.validate((JsPath \ "category").read[Category.Value])
        layer <- (dataFormat, category) match {
          case (DataFormat.knossos, Category.segmentation) => json.validate[KnossosSegmentationLayer]
          case (DataFormat.knossos, _)                     => json.validate[KnossosDataLayer]
          case (DataFormat.wkw, Category.segmentation)     => json.validate[WKWSegmentationLayer]
          case (DataFormat.wkw, _)                         => json.validate[WKWDataLayer]
          case _                                           => json.validate[WKWDataLayer]
        }
      } yield {
        layer
      }

    override def writes(layer: DataLayer): JsValue =
      (layer match {
        case l: KnossosDataLayer         => KnossosDataLayer.knossosDataLayerFormat.writes(l)
        case l: KnossosSegmentationLayer => KnossosSegmentationLayer.knossosSegmentationLayerFormat.writes(l)
        case l: WKWDataLayer             => WKWDataLayer.wkwDataLayerFormat.writes(l)
        case l: WKWSegmentationLayer     => WKWSegmentationLayer.wkwSegmentationLayerFormat.writes(l)
      }).as[JsObject] ++ Json.obj(
        "category" -> layer.category,
        "dataFormat" -> layer.dataFormat
      )
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
    resolutions: List[Point3D],
    elementClass: ElementClass.Value,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends DataLayerLike

object AbstractDataLayer {

  def from(layer: DataLayerLike): AbstractDataLayer =
    AbstractDataLayer(
      layer.name,
      layer.category,
      layer.boundingBox,
      layer.resolutions,
      layer.elementClass,
      layer.defaultViewConfiguration,
      layer.adminViewConfiguration
    )

  implicit val abstractDataLayerFormat = Json.format[AbstractDataLayer]
}

case class AbstractSegmentationLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    resolutions: List[Point3D],
    elementClass: ElementClass.Value,
    largestSegmentId: Long,
    mappings: Option[Set[String]],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None
) extends SegmentationLayerLike

object AbstractSegmentationLayer {

  def from(layer: SegmentationLayerLike): AbstractSegmentationLayer =
    AbstractSegmentationLayer(
      layer.name,
      layer.category,
      layer.boundingBox,
      layer.resolutions,
      layer.elementClass,
      layer.largestSegmentId,
      layer.mappings,
      layer.defaultViewConfiguration,
      layer.adminViewConfiguration
    )

  implicit val abstractSegmentationLayerFormat = Json.format[AbstractSegmentationLayer]
}

trait ResolutionFormatHelper {

  implicit object resolutionFormat extends Format[Either[Int, Point3D]] {

    override def reads(json: JsValue): JsResult[Either[Int, Point3D]] =
      json.validate[Int].map[Either[Int, Point3D]](Left(_)).orElse(json.validate[Point3D].map(Right(_)))

    override def writes(resolution: Either[Int, Point3D]): JsValue = resolution match {
      case Left(r)  => JsNumber(r)
      case Right(r) => Point3D.Point3DWrites.writes(r)
    }
  }
}
