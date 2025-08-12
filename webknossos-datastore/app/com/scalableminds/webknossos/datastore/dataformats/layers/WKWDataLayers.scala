package com.scalableminds.webknossos.datastore.dataformats.layers

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import play.api.libs.json.{Format, JsError, JsResult, JsSuccess, JsValue, Json, OFormat}

case class WKWResolution(resolution: Vec3Int,
                         cubeLength: Int,
                         path: Option[String] = None,
                         credentialId: Option[String] = None) {
  def toMagLocator: MagLocator =
    MagLocator(mag = resolution, path = path, credentialId = credentialId)

}
object WKWResolution extends MagFormatHelper {
  implicit val jsonFormat: OFormat[WKWResolution] = Json.format[WKWResolution]
}

trait WKWLayer extends DataLayerWithMagLocators {
  val dataFormat: DataFormat.Value = DataFormat.wkw
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
  override def resolutions: List[Vec3Int] = mags.map(_.mag)
}

object WKWDataLayer {
  implicit val jsonFormat: Format[WKWDataLayer] = new Format[WKWDataLayer] {
    def reads(json: JsValue): JsResult[WKWDataLayer] =
      for {
        mags: List[MagLocator] <- (json \ "mags").validate[List[MagLocator]] match {
          case JsSuccess(value, _) => JsSuccess(value)
          case JsError(_) =>
            (json \ "wkwResolutions").validate[List[WKWResolution]] match {
              case JsSuccess(value, _) => JsSuccess(value.map(_.toMagLocator))
              case JsError(_)          => JsError("Either 'mags' or 'wkwResolutions' must be provided")
            }
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
          mags,
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
  override def resolutions: List[Vec3Int] = mags.map(_.mag)
}

object WKWSegmentationLayer {
  implicit val jsonFormat: Format[WKWSegmentationLayer] = new Format[WKWSegmentationLayer] {
    def reads(json: JsValue): JsResult[WKWSegmentationLayer] =
      for {
        mags: List[MagLocator] <- (json \ "mags").validate[List[MagLocator]] match {
          case JsSuccess(value, _) => JsSuccess(value)
          case JsError(_) =>
            (json \ "wkwResolutions").validate[List[WKWResolution]] match {
              case JsSuccess(value, _) => JsSuccess(value.map(_.toMagLocator))
              case JsError(_)          => JsError("Either 'mags' or 'wkwResolutions' must be provided")
            }
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
          mags,
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
