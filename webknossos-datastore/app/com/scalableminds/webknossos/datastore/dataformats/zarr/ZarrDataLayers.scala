package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import play.api.libs.json.{Json, OFormat}
import ucar.ma2.{Array => MultiArray}

trait ZarrLayer extends DataLayerWithMagLocators {

  val dataFormat: DataFormat.Value = DataFormat.zarr

  def bucketProvider(remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                     dataSourceId: DataSourceId,
                     sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]]) =
    new ZarrBucketProvider(this, dataSourceId, remoteSourceDescriptorServiceOpt, sharedChunkContentsCache)

  def resolutions: List[Vec3Int] = mags.map(_.mag)

  def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = Int.MaxValue // Prevents the wkw-shard-specific handle caching

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
    override val additionalAxes: Option[Seq[AdditionalAxis]]
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
    additionalAxes: Option[Seq[AdditionalAxis]] = None
) extends SegmentationLayer
    with ZarrLayer

object ZarrSegmentationLayer {
  implicit val jsonFormat: OFormat[ZarrSegmentationLayer] = Json.format[ZarrSegmentationLayer]
}

object ZarrCoordinatesParser {
  def parseDotCoordinates(
      cxyz: String,
  ): Option[(Int, Int, Int, Int)] = {
    val singleRx = "\\s*([0-9]+).([0-9]+).([0-9]+).([0-9]+)\\s*".r

    cxyz match {
      case singleRx(c, x, y, z) =>
        Some(Integer.parseInt(c), Integer.parseInt(x), Integer.parseInt(y), Integer.parseInt(z))
      case _ => None
    }
  }
}
