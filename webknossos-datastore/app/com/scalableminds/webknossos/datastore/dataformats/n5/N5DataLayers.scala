package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.net.URI
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.n5.N5BucketProvider
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import play.api.libs.json.{Json, OFormat}

case class N5Mag(mag: Vec3Int,
                 path: Option[String],
                 credentials: Option[FileSystemCredentials],
                 axisOrder: Option[AxisOrder]) {

  lazy val pathWithFallback: String =
    path.getOrElse(if (mag.isIsotropic) s"${mag.x}" else s"${mag.x}-${mag.y}-${mag.z}")
  private lazy val uri: URI = new URI(pathWithFallback)
  private lazy val isRemote: Boolean = FileSystemsHolder.isSupportedRemoteScheme(uri.getScheme)
  lazy val remoteSource: Option[RemoteSourceDescriptor] =
    if (isRemote)
      Some(RemoteSourceDescriptor(uri, credentials.map(_.user), credentials.flatMap(_.password)))
    else
      None

}

object N5Mag extends ResolutionFormatHelper {
  implicit val jsonFormat: OFormat[N5Mag] = Json.format[N5Mag]
}

trait N5Layer extends DataLayer {

  val dataFormat: DataFormat.Value = DataFormat.n5

  lazy val bucketProvider = new N5BucketProvider(this)

  def resolutions: List[Vec3Int] = mags.map(_.mag)

  def mags: List[N5Mag]

  def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = Int.MaxValue // Prevents the wkw-shard-specific handle caching

  def numChannels: Option[Int] = Some(if (elementClass == ElementClass.uint24) 3 else 1)

}

case class N5DataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[N5Mag],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    override val numChannels: Option[Int] = Some(1)
) extends N5Layer

object N5DataLayer {
  implicit val jsonFormat: OFormat[N5DataLayer] = Json.format[N5DataLayer]
}

case class N5SegmentationLayer(
    name: String,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[N5Mag],
    largestSegmentId: Long,
    mappings: Option[Set[String]] = None,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    override val numChannels: Option[Int] = Some(1)
) extends SegmentationLayer
    with N5Layer

object N5SegmentationLayer {
  implicit val jsonFormat: OFormat[N5SegmentationLayer] = Json.format[N5SegmentationLayer]
}
