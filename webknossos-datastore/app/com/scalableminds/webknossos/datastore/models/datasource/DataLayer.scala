package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.webknossos.datastore.dataformats.{
  BucketProvider,
  DatasetArrayBucketProvider,
  MagLocator,
  MappingProvider
}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.helpers.UPath
import ucar.ma2.{Array => MultiArray}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import play.api.libs.json._

trait DataLayer {
  def name: String
  def category: LayerCategory.Value
  def boundingBox: BoundingBox
  def resolutions: List[Vec3Int]
  def elementClass: ElementClass.Value

  def bucketProvider(remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                     dataSourceId: DataSourceId,
                     sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]]): BucketProvider

  def bucketProviderCacheKey: String

  // This is the default from the DataSource JSON.
  def defaultViewConfiguration: Option[LayerViewConfiguration]

  // This is the default from the Dataset Edit View.
  def adminViewConfiguration: Option[LayerViewConfiguration]

  def coordinateTransformations: Option[List[CoordinateTransformation]]

  // n-dimensional datasets = 3-dimensional datasets with additional coordinate axes
  def additionalAxes: Option[Seq[AdditionalAxis]]

  def attachments: Option[DataLayerAttachments]

  // Datasets that are not in the WKW format use mags
  def magsOpt: Option[List[MagLocator]] = this match {
    case layer: StaticLayer => Some(layer.mags)
    case _                  => None
  }

  def allExplicitPaths: Seq[UPath] =
    magsOpt.map(_.flatMap(_.path)).getOrElse(Seq.empty) ++
      attachments.map(_.allAttachments.map(_.path)).getOrElse(Seq.empty)

  def containsMag(mag: Vec3Int): Boolean = resolutions.contains(mag)

  def doesContainBucket(bucket: BucketPosition): Boolean =
    boundingBox.intersects(bucket.toMag1BoundingBox)

  lazy val bytesPerElement: Int =
    ElementClass.bytesPerElement(elementClass)

  lazy val sortedMags: List[Vec3Int] = resolutions.sortBy(_.maxDim)
}

object DataLayer {
  val bucketLength: Int = 32
  val bucketSize: Vec3Int = Vec3Int(bucketLength, bucketLength, bucketLength)
}

trait StaticLayer extends DataLayer {

  def dataFormat: DataFormat.Value

  def bucketProvider(remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                     dataSourceId: DataSourceId,
                     sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]]): BucketProvider =
    new DatasetArrayBucketProvider(this, dataSourceId, remoteSourceDescriptorServiceOpt, sharedChunkContentsCache)

  def bucketProviderCacheKey: String = this.name

  def mags: List[MagLocator]

  def resolutions: List[Vec3Int] = mags.map(_.mag)

  def numChannels: Int = if (elementClass == ElementClass.uint24) 3 else 1

  def withAttachments(attachments: DataLayerAttachments): StaticLayer =
    this match {
      case l: StaticSegmentationLayer =>
        l.copy(attachments = l.attachments.map(_.merge(attachments)).orElse(Some(attachments)))
      case l: StaticColorLayer =>
        l.copy(attachments = l.attachments.map(_.merge(attachments)).orElse(Some(attachments)))
    }

  def mapped(
      boundingBoxMapping: BoundingBox => BoundingBox = b => b,
      defaultViewConfigurationMapping: Option[LayerViewConfiguration] => Option[LayerViewConfiguration] = l => l,
      magMapping: MagLocator => MagLocator = m => m,
      name: String = this.name,
      coordinateTransformations: Option[List[CoordinateTransformation]] = this.coordinateTransformations): StaticLayer =
    this match {
      case l: StaticColorLayer =>
        l.copy(
          boundingBox = boundingBoxMapping(l.boundingBox),
          defaultViewConfiguration = defaultViewConfigurationMapping(l.defaultViewConfiguration),
          mags = l.mags.map(magMapping),
          name = name,
          coordinateTransformations = coordinateTransformations
        )
      case l: StaticSegmentationLayer =>
        l.copy(
          boundingBox = boundingBoxMapping(l.boundingBox),
          defaultViewConfiguration = defaultViewConfigurationMapping(l.defaultViewConfiguration),
          mags = l.mags.map(magMapping),
          name = name,
          coordinateTransformations = coordinateTransformations
        )
    }
}

object StaticLayer {

  implicit object staticLayerFormat extends Format[StaticLayer] with MagFormatHelper {
    override def reads(json: JsValue): JsResult[StaticLayer] =
      for {
        category <- json.validate((JsPath \ "category").read[LayerCategory.Value])
        layer <- category match {
          case LayerCategory.color        => json.validate[StaticColorLayer]
          case LayerCategory.segmentation => json.validate[StaticSegmentationLayer]
        }
      } yield layer

    override def writes(layer: StaticLayer): JsValue =
      Json.obj("category" -> layer.category) ++
        (layer match {
          case l: StaticColorLayer        => StaticColorLayer.jsonFormat.writes(l)
          case l: StaticSegmentationLayer => StaticSegmentationLayer.jsonFormat.writes(l)
        }).as[JsObject] ++
        Json.obj(
          "resolutions" -> layer.resolutions, // TODO remove again, adapt clients, introduce new api version?
          "numChannels" -> layer.numChannels
        )
  }

}

trait SegmentationLayer extends DataLayer {
  def largestSegmentId: Option[Long]
  def mappings: Option[Set[String]]

  def category: LayerCategory.Value = LayerCategory.segmentation
  lazy val mappingProvider: MappingProvider = new MappingProvider(this)
}

case class StaticColorLayer(name: String,
                            dataFormat: DataFormat.Value,
                            boundingBox: BoundingBox,
                            elementClass: ElementClass.Value,
                            mags: List[MagLocator],
                            defaultViewConfiguration: Option[LayerViewConfiguration] = None,
                            adminViewConfiguration: Option[LayerViewConfiguration] = None,
                            coordinateTransformations: Option[List[CoordinateTransformation]] = None,
                            additionalAxes: Option[Seq[AdditionalAxis]] = None,
                            attachments: Option[DataLayerAttachments] = None)
    extends StaticLayer {
  def category: LayerCategory.Value = LayerCategory.color
}

object StaticColorLayer {
  implicit val jsonFormat: Format[StaticColorLayer] = new Format[StaticColorLayer] {
    def reads(json: JsValue): JsResult[StaticColorLayer] =
      for {
        mags: List[MagLocator] <- (json \ "mags").validate[List[MagLocator]] match {
          case JsSuccess(value, _) => JsSuccess(value)
          case JsError(_) =>
            (json \ "wkwResolutions").validate[List[WkwResolution]] match {
              case JsSuccess(value, _) => JsSuccess(value.map(_.toMagLocator))
              case JsError(_)          => JsError("Either 'mags' or 'wkwResolutions' must be provided")
            }
        }
        dataFormat <- (json \ "dataFormat").validate[DataFormat.Value]
        name <- (json \ "name").validate[String]
        boundingBox <- (json \ "boundingBox").validate[BoundingBox]
        elementClass <- (json \ "elementClass").validate[ElementClass.Value]
        defaultViewConfiguration <- (json \ "defaultViewConfiguration").validateOpt[LayerViewConfiguration]
        adminViewConfiguration <- (json \ "adminViewConfiguration").validateOpt[LayerViewConfiguration]
        coordinateTransformations <- (json \ "coordinateTransformations").validateOpt[List[CoordinateTransformation]]
        additionalAxes <- (json \ "additionalAxes").validateOpt[Seq[AdditionalAxis]]
        attachments <- (json \ "attachments").validateOpt[DataLayerAttachments]
      } yield {
        StaticColorLayer(
          name,
          dataFormat,
          boundingBox,
          elementClass,
          mags,
          defaultViewConfiguration,
          adminViewConfiguration,
          coordinateTransformations,
          additionalAxes,
          attachments
        )
      }

    def writes(layer: StaticColorLayer): JsValue =
      Json.writes[StaticColorLayer].writes(layer)
  }
}

case class StaticSegmentationLayer(name: String,
                                   dataFormat: DataFormat.Value,
                                   boundingBox: BoundingBox,
                                   elementClass: ElementClass.Value,
                                   mags: List[MagLocator],
                                   defaultViewConfiguration: Option[LayerViewConfiguration] = None,
                                   adminViewConfiguration: Option[LayerViewConfiguration] = None,
                                   coordinateTransformations: Option[List[CoordinateTransformation]] = None,
                                   additionalAxes: Option[Seq[AdditionalAxis]] = None,
                                   attachments: Option[DataLayerAttachments] = None,
                                   largestSegmentId: Option[Long] = None,
                                   mappings: Option[Set[String]] = None)
    extends StaticLayer
    with SegmentationLayer

object StaticSegmentationLayer {
  implicit val jsonFormat: Format[StaticSegmentationLayer] = new Format[StaticSegmentationLayer] {
    def reads(json: JsValue): JsResult[StaticSegmentationLayer] =
      for {
        mags: List[MagLocator] <- (json \ "mags").validate[List[MagLocator]] match {
          case JsSuccess(value, _) => JsSuccess(value)
          case JsError(_) =>
            (json \ "wkwResolutions").validate[List[WkwResolution]] match {
              case JsSuccess(value, _) => JsSuccess(value.map(_.toMagLocator))
              case JsError(_)          => JsError("Either 'mags' or 'wkwResolutions' must be provided")
            }
        }
        dataFormat <- (json \ "dataFormat").validate[DataFormat.Value]
        name <- (json \ "name").validate[String]
        largestSegmentId <- (json \ "largestSegmentId").validateOpt[Long]
        mappings <- (json \ "mappings").validateOpt[Set[String]]
        boundingBox <- (json \ "boundingBox").validate[BoundingBox]
        elementClass <- (json \ "elementClass").validate[ElementClass.Value]
        defaultViewConfiguration <- (json \ "defaultViewConfiguration").validateOpt[LayerViewConfiguration]
        adminViewConfiguration <- (json \ "adminViewConfiguration").validateOpt[LayerViewConfiguration]
        coordinateTransformations <- (json \ "coordinateTransformations").validateOpt[List[CoordinateTransformation]]
        additionalAxes <- (json \ "additionalAxes").validateOpt[Seq[AdditionalAxis]]
        attachments <- (json \ "attachments").validateOpt[DataLayerAttachments]
      } yield {
        StaticSegmentationLayer(
          name,
          dataFormat,
          boundingBox,
          elementClass,
          mags,
          defaultViewConfiguration,
          adminViewConfiguration,
          coordinateTransformations,
          additionalAxes,
          attachments,
          largestSegmentId,
          mappings
        )
      }

    def writes(layer: StaticSegmentationLayer): JsValue =
      Json.writes[StaticSegmentationLayer].writes(layer)
  }
}
