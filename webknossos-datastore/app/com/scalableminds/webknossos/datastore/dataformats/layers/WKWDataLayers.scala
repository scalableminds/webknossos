package com.scalableminds.webknossos.datastore.dataformats.layers

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DatasetArrayBucketProvider, MagLocator}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import play.api.libs.json.{Format, JsError, JsResult, JsSuccess, JsValue, Json, OFormat}
import ucar.ma2.{Array => MultiArray}

case class WKWResolution(resolution: Vec3Int, cubeLength: Int)

object WKWResolution extends MagFormatHelper {
  implicit val jsonFormat: OFormat[WKWResolution] = Json.format[WKWResolution]
}

trait WKWLayer extends DataLayer {

  val dataFormat: DataFormat.Value = DataFormat.wkw

  override def bucketProvider(remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                              dataSourceId: DataSourceId,
                              sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]]): BucketProvider =
    new DatasetArrayBucketProvider(this, dataSourceId, remoteSourceDescriptorServiceOpt, sharedChunkContentsCache)

  def wkwResolutions: List[WKWResolution]

  def resolutions: List[Vec3Int] = wkwResolutions.map(_.resolution)

  def defaultCubeSize = 32

  def lengthOfUnderlyingCubes(mag: Vec3Int): Int =
    wkwResolutions.find(_.resolution == mag).map(_ => defaultCubeSize).getOrElse(0)

}

case class WKWDataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    mags: List[MagLocator],
    elementClass: ElementClass.Value,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    attachments: Option[DatasetLayerAttachments] = None,
) extends WKWLayer {
  override def asAbstractLayer: DataLayerLike =
    AbstractDataLayer(
      name,
      category,
      boundingBox,
      resolutions,
      elementClass,
      defaultViewConfiguration,
      adminViewConfiguration,
      coordinateTransformations,
      additionalAxes,
      attachments,
      None,
      None,
      Some(dataFormat)
    )

  override def wkwResolutions: List[WKWResolution] = mags.map(mag => WKWResolution(mag.mag, defaultCubeSize))
}

object WKWDataLayer {
  implicit val jsonFormat: Format[WKWDataLayer] = new Format[WKWDataLayer] {
    def reads(json: JsValue): JsResult[WKWDataLayer] =
      for {
        mag: List[MagLocator] <- (json \ "wkwResolutions").validate[List[WKWResolution]] match {
          case JsSuccess(value, _) => JsSuccess(value.map(resolution => MagLocator(resolution.resolution)))
          case JsError(_)          => (json \ "mags").validate[List[MagLocator]]
        }
        name <- (json \ "name").validate[String]
        category <- (json \ "category").validate[Category.Value]
        boundingBox <- (json \ "boundingBox").validate[BoundingBox]
        elementClass <- (json \ "elementClass").validate[ElementClass.Value]
        defaultViewConfiguration <- (json \ "defaultViewConfiguration").validateOpt[LayerViewConfiguration]
        adminViewConfiguration <- (json \ "adminViewConfiguration").validateOpt[LayerViewConfiguration]
        coordinateTransformations <- (json \ "coordinateTransformations").validateOpt[List[CoordinateTransformation]]
        additionalAxes <- (json \ "additionalAxes").validateOpt[Seq[AdditionalAxis]]
        attachments <- (json \ "attachments").validateOpt[DatasetLayerAttachments]
      } yield {
        WKWDataLayer(
          name,
          category,
          boundingBox,
          mag,
          elementClass,
          defaultViewConfiguration,
          adminViewConfiguration,
          coordinateTransformations,
          additionalAxes,
          attachments
        )
      }

    def writes(layer: WKWDataLayer): JsValue =
      Json.writes[WKWDataLayer].writes(layer)
  }
}

case class WKWSegmentationLayer(
    name: String,
    boundingBox: BoundingBox,
    mags: List[MagLocator],
    elementClass: ElementClass.Value,
    mappings: Option[Set[String]],
    largestSegmentId: Option[Long] = None,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    attachments: Option[DatasetLayerAttachments] = None
) extends SegmentationLayer
    with WKWLayer {
  def asAbstractLayer: AbstractSegmentationLayer =
    AbstractSegmentationLayer(
      name,
      Category.segmentation,
      boundingBox,
      resolutions,
      elementClass,
      largestSegmentId,
      mappings,
      defaultViewConfiguration,
      adminViewConfiguration,
      coordinateTransformations,
      additionalAxes,
      attachments,
      None,
      None,
      Some(dataFormat)
    )

  override def wkwResolutions: List[WKWResolution] = mags.map(mag => WKWResolution(mag.mag, defaultCubeSize))
}

object WKWSegmentationLayer {
  implicit val jsonFormat: Format[WKWSegmentationLayer] = new Format[WKWSegmentationLayer] {
    def reads(json: JsValue): JsResult[WKWSegmentationLayer] =
      for {
        mag: List[MagLocator] <- (json \ "wkwResolutions").validate[List[WKWResolution]] match {
          case JsSuccess(value, _) => JsSuccess(value.map(resolution => MagLocator(resolution.resolution)))
          case JsError(_)          => (json \ "mags").validate[List[MagLocator]]
        }
        name <- (json \ "name").validate[String]
        boundingBox <- (json \ "boundingBox").validate[BoundingBox]
        elementClass <- (json \ "elementClass").validate[ElementClass.Value]
        largestSegmentId <- (json \ "largestSegmentId").validateOpt[Long]
        mappings <- (json \ "mappings").validateOpt[Set[String]]
        defaultViewConfiguration <- (json \ "defaultViewConfiguration").validateOpt[LayerViewConfiguration]
        adminViewConfiguration <- (json \ "adminViewConfiguration").validateOpt[LayerViewConfiguration]
        coordinateTransformations <- (json \ "coordinateTransformations").validateOpt[List[CoordinateTransformation]]
        additionalAxes <- (json \ "additionalAxes").validateOpt[Seq[AdditionalAxis]]
        attachments <- (json \ "attachments").validateOpt[DatasetLayerAttachments]
      } yield {
        WKWSegmentationLayer(
          name,
          boundingBox,
          mag,
          elementClass,
          mappings,
          largestSegmentId,
          defaultViewConfiguration,
          adminViewConfiguration,
          coordinateTransformations,
          additionalAxes,
          attachments
        )
      }

    def writes(layer: WKWSegmentationLayer): JsValue =
      Json.writes[WKWSegmentationLayer].writes(layer)
  }
}
