package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.net.URI

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import play.api.libs.json.{Json, OFormat}

case class FileSystemCredentials(user: String, password: Option[String])

object FileSystemCredentials {
  implicit val jsonFormat: OFormat[FileSystemCredentials] = Json.format[FileSystemCredentials]
}

case class RemoteSourceDescriptor(uri: URI, user: Option[String], password: Option[String]) {
  lazy val remotePath: String = uri.getPath
  lazy val credentials: Option[FileSystemCredentials] = user.map(u => FileSystemCredentials(u, password))
}

case class ZarrMag(mag: Vec3Int, path: Option[String], credentials: Option[FileSystemCredentials]) {

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

object ZarrMag extends ResolutionFormatHelper {
  implicit val jsonFormat: OFormat[ZarrMag] = Json.format[ZarrMag]
}

trait ZarrLayer extends DataLayer {

  val dataFormat: DataFormat.Value = DataFormat.zarr

  lazy val bucketProvider = new ZarrBucketProvider(this)

  def resolutions: List[Vec3Int] = mags.map(_.mag)

  def mags: List[ZarrMag]

  def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = Int.MaxValue // Prevents the wkw-shard-specific handle caching

  def numChannels: Option[Int] = Some(if (elementClass == ElementClass.uint24) 3 else 1)

}

case class ZarrDataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[ZarrMag],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    override val numChannels: Option[Int] = Some(1)
) extends ZarrLayer

object ZarrDataLayer {
  implicit val jsonFormat: OFormat[ZarrDataLayer] = Json.format[ZarrDataLayer]
}

case class ZarrSegmentationLayer(
    name: String,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[ZarrMag],
    largestSegmentId: Long,
    mappings: Option[Set[String]],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    override val numChannels: Option[Int] = Some(1)
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
