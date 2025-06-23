package com.scalableminds.webknossos.datastore.dataformats.layers

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DatasetArrayBucketProvider, MagLocator}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import play.api.libs.json.{Json, OFormat}
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

  def mags: List[MagLocator] = wkwResolutions.map(wkwResolution => MagLocator(wkwResolution.resolution))

  def resolutions: List[Vec3Int] = wkwResolutions.map(_.resolution)

  def lengthOfUnderlyingCubes(mag: Vec3Int): Int =
    wkwResolutions.find(_.resolution == mag).map(_.cubeLength).getOrElse(0)

}

case class WKWDataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    wkwResolutions: List[WKWResolution],
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
}

object WKWDataLayer {
  implicit val jsonFormat: OFormat[WKWDataLayer] = Json.format[WKWDataLayer]
}

case class WKWSegmentationLayer(
    name: String,
    boundingBox: BoundingBox,
    wkwResolutions: List[WKWResolution],
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
}

object WKWSegmentationLayer {
  implicit val jsonFormat: OFormat[WKWSegmentationLayer] = Json.format[WKWSegmentationLayer]
}
