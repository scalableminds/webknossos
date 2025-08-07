package com.scalableminds.webknossos.datastore.dataformats.layers

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.{DatasetArrayBucketProvider, MagLocator}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import play.api.libs.json.{Json, OFormat}
import ucar.ma2.{Array => MultiArray}

trait PrecomputedLayer extends DataLayerWithMagLocators {

  val dataFormat: DataFormat.Value = DataFormat.neuroglancerPrecomputed

  def bucketProvider(remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                     dataSourceId: DataSourceId,
                     sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]]) =
    new DatasetArrayBucketProvider(this, dataSourceId, remoteSourceDescriptorServiceOpt, sharedChunkContentsCache)

  def resolutions: List[Vec3Int] = mags.map(_.mag)

  def numChannels: Option[Int] = Some(if (elementClass == ElementClass.uint24) 3 else 1)
}

case class PrecomputedDataLayer(
    name: String,
    boundingBox: BoundingBox,
    category: Category.Value,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1),
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    attachments: Option[DatasetLayerAttachments] = None,
) extends PrecomputedLayer {
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
      Some(mags),
      numChannels,
      Some(dataFormat)
    )
}

object PrecomputedDataLayer {
  implicit val jsonFormat: OFormat[PrecomputedDataLayer] = Json.format[PrecomputedDataLayer]
}

case class PrecomputedSegmentationLayer(
    name: String,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    largestSegmentId: Option[Long],
    mappings: Option[Set[String]] = None,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1),
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    attachments: Option[DatasetLayerAttachments] = None,
) extends SegmentationLayer
    with PrecomputedLayer {
  override def asAbstractLayer: DataLayerLike =
    AbstractSegmentationLayer(
      name,
      category,
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
      Some(mags),
      numChannels,
      Some(dataFormat)
    )
}

object PrecomputedSegmentationLayer {
  implicit val jsonFormat: OFormat[PrecomputedSegmentationLayer] = Json.format[PrecomputedSegmentationLayer]
}
