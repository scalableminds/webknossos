package com.scalableminds.webknossos.datastore.dataformats.zarr.v3

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.models.datasource.{
  Category,
  CoordinateTransformation,
  DataFormat,
  DataLayer,
  ElementClass
}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import play.api.libs.json.{Json, OFormat}

trait ZarrV3Layer extends DataLayer {

  val dataFormat: DataFormat.Value = DataFormat.zarrV3

  def bucketProvider(dataVaultServiceOpt: Option[DataVaultService]) =
    new ZarrV3BucketProvider(this, dataVaultServiceOpt)

  def resolutions: List[Vec3Int] = mags.map(_.mag)

  def mags: List[MagLocator]

  def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = Int.MaxValue // Prevents the wkw-shard-specific handle caching

  def numChannels: Option[Int] = Some(if (elementClass == ElementClass.uint24) 3 else 1)

}

case class ZarrV3DataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1)
) extends ZarrV3Layer

object ZarrV3DataLayer {
  implicit val jsonFormat: OFormat[ZarrV3DataLayer] = Json.format[ZarrV3DataLayer]
}
