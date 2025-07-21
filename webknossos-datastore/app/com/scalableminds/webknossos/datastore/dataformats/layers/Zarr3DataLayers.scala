package com.scalableminds.webknossos.datastore.dataformats.layers

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.{DatasetArrayBucketProvider, MagLocator}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import play.api.libs.json.{Json, OFormat}
import ucar.ma2.{Array => MultiArray}

trait Zarr3Layer extends DataLayerWithMagLocators {

  val dataFormat: DataFormat.Value = DataFormat.zarr3

  def bucketProvider(remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                     dataSourceId: DataSourceId,
                     sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]]) =
    new DatasetArrayBucketProvider(this, dataSourceId, remoteSourceDescriptorServiceOpt, sharedChunkContentsCache)

  def resolutions: List[Vec3Int] = mags.map(_.mag)

  def lengthOfUnderlyingCubes(mag: Vec3Int): Int = Int.MaxValue // Prevents the wkw-shard-specific handle caching

  def numChannels: Option[Int] = Some(if (elementClass == ElementClass.uint24) 3 else 1)

}

case class Zarr3DataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1),
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    attachments: Option[DatasetLayerAttachments] = None
) extends Zarr3Layer

object Zarr3DataLayer {
  implicit val jsonFormat: OFormat[Zarr3DataLayer] = Json.format[Zarr3DataLayer]
}

case class Zarr3SegmentationLayer(
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
    attachments: Option[DatasetLayerAttachments] = None
) extends SegmentationLayer
    with Zarr3Layer

object Zarr3SegmentationLayer {
  implicit val jsonFormat: OFormat[Zarr3SegmentationLayer] = Json.format[Zarr3SegmentationLayer]
}
