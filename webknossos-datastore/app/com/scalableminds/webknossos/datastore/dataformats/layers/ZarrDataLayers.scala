package com.scalableminds.webknossos.datastore.dataformats.layers

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.{DatasetArrayBucketProvider, MagLocator}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{DataFormat, _}
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import play.api.libs.json.{Json, OFormat}
import ucar.ma2.{Array => MultiArray}

trait ZarrLayer extends DataLayerWithMagLocators {

  def bucketProvider(remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                     dataSourceId: DataSourceId,
                     sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]]) =
    new DatasetArrayBucketProvider(this, dataSourceId, remoteSourceDescriptorServiceOpt, sharedChunkContentsCache)

  def resolutions: List[Vec3Int] = mags.map(_.mag)

  def numChannels: Option[Int] = Some(if (elementClass == ElementClass.uint24) 3 else 1)
}

case class ZarrDataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1),
    override val additionalAxes: Option[Seq[AdditionalAxis]],
    attachments: Option[DatasetLayerAttachments] = None,
    override val dataFormat: DataFormat.Value,
) extends ZarrLayer

object ZarrDataLayer {
  implicit val jsonFormat: OFormat[ZarrDataLayer] = Json.format[ZarrDataLayer]
}

case class ZarrSegmentationLayer(
    name: String,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    largestSegmentId: Option[Long] = None,
    mappings: Option[Set[String]] = None,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1),
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    attachments: Option[DatasetLayerAttachments] = None,
    override val dataFormat: DataFormat.Value,
) extends SegmentationLayer
    with ZarrLayer

object ZarrSegmentationLayer {
  implicit val jsonFormat: OFormat[ZarrSegmentationLayer] = Json.format[ZarrSegmentationLayer]
}
