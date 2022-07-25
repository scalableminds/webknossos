package models.binary

import java.net.URI
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.dataformats.zarr.{RemoteSourceDescriptor, ZarrDataLayer, ZarrMag}
import com.scalableminds.webknossos.datastore.jzarr.{
  OmeNgffAxis,
  OmeNgffCoordinateTransformation,
  OmeNgffDataset,
  OmeNgffHeader,
  OmeNgffOneHeader,
  ZarrHeader
}
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayer}
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import net.liftweb.common.{Box, Full}
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.Reads

import scala.concurrent.ExecutionContext

case class AxisOrder(x: Int, y: Int, z: Int)

class ExploreRemoteLayerService @Inject()() extends FoxImplicits with LazyLogging {

  def exploreRemoteLayers(layerUri: String)(implicit ec: ExecutionContext): Fox[List[DataLayer]] = {
    val uri = new URI(layerUri)
    val remoteSource = RemoteSourceDescriptor(uri, None, None)
    for {
      fileSystem <- FileSystemsHolder.getOrCreate(remoteSource).toFox ?~> "failed to get file system"
      remotePath <- tryo(fileSystem.getPath(remoteSource.remotePath)) ?~> "failed to get remote path"
      dataLayers <- exploreAsArrayOrNgff(remotePath)
    } yield dataLayers
  }

  private def exploreAsArrayOrNgff(remotePath: Path)(implicit ec: ExecutionContext): Fox[List[DataLayer]] =
    for {
      asArrayBox <- exploreAsZarrArray(remotePath).futureBox
      result <- asArrayBox match {
        case Full(asArrayResult) => Fox.successful(asArrayResult)
        case _                   => exploreAsOmeNgff(remotePath)
      }
    } yield result

  private def exploreAsZarrArray(remotePath: Path)(implicit ec: ExecutionContext): Fox[List[DataLayer]] =
    for {
      zarrayPath <- Fox.successful(guessZarrayPath(remotePath))
      zarrHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at $zarrayPath"
      _ = logger.info(zarrHeader.toString)
      elementClass <- zarrHeader.elementClass
      boundingBox <- zarrHeader.boundingBox
      zarrMag = ZarrMag(Vec3Int.ones, Some(remotePath.toString), credentials = None)
    } yield List(ZarrDataLayer(guessNameFromPath(remotePath), Category.color, boundingBox, elementClass, List(zarrMag)))

  private def parseJsonFromPath[T: Reads](path: Path): Box[T] =
    for {
      fileAsString <- tryo(new String(Files.readAllBytes(path), StandardCharsets.UTF_8))
      parsed <- JsonHelper.parseJsonToFox[T](fileAsString)
    } yield parsed

  private def guessZarrayPath(layerPath: Path): Path =
    if (layerPath.endsWith(ZarrHeader.FILENAME_DOT_ZARRAY)) layerPath
    else layerPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)

  private def guessZattrsPath(layerPath: Path): Path =
    if (layerPath.endsWith(OmeNgffHeader.FILENAME_DOT_ZATTRS)) layerPath
    else layerPath.resolve(OmeNgffHeader.FILENAME_DOT_ZATTRS)

  private def exploreAsOmeNgff(remotePath: Path)(implicit ec: ExecutionContext): Fox[List[DataLayer]] =
    for {
      zattrsPath <- Fox.successful(guessZattrsPath(remotePath))
      omeNgffHeader <- parseJsonFromPath[OmeNgffHeader](zattrsPath) ?~> s"failed to read ome ngff header at $zattrsPath"
      _ <- Fox.successful(logger.info(f"OMG: $omeNgffHeader"))
      layers <- Fox.serialCombined(omeNgffHeader.multiscales)(layerFromMultiscale(_, remotePath))
    } yield layers

  private def layerFromMultiscale(multiscale: OmeNgffOneHeader, remotePath: Path)(
      implicit ec: ExecutionContext): Fox[DataLayer] =
    for {
      axisOrder <- extractAxisOrder(multiscale.axes)
      voxelSize <- extractVoxelSize(multiscale.datasets.map(_.coordinateTransformations), axisOrder)
      mags <- Fox.serialCombined(multiscale.datasets)(d => magFromNgffDataset(d, remotePath, voxelSize, axisOrder))
      firstMagPath <- multiscale.datasets.headOption.map(d => remotePath.resolve(d.path)).toFox
      zarrHeader <- parseJsonFromPath[ZarrHeader](firstMagPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)).toFox
      elementClass <- zarrHeader.elementClass.toFox
      boundingBox <- zarrHeader.boundingBox.toFox
    } yield
      ZarrDataLayer(
        multiscale.name.getOrElse(guessNameFromPath(remotePath)),
        Category.color,
        boundingBox,
        elementClass,
        mags
      )

  private def magFromNgffDataset(dataset: OmeNgffDataset, layerPath: Path, voxelSize: Vec3Double, axisOrder: AxisOrder)(
      implicit ec: ExecutionContext): Fox[ZarrMag] =
    for {
      mag <- magFromTransforms(dataset.coordinateTransformations, voxelSize, axisOrder)
    } yield ZarrMag(mag, Some(layerPath.resolve(dataset.path).toString), None)

  private def guessNameFromPath(path: Path): String =
    "explored_remote_dataset" // TODO

  private def extractAxisOrder(axes: List[OmeNgffAxis])(implicit ec: ExecutionContext): Fox[AxisOrder] = {
    def axisMatches(axis: OmeNgffAxis, name: String) = axis.name.toLowerCase == name && axis.`type` == "space"
    val x = axes.indexWhere(axisMatches(_, "x"))
    val y = axes.indexWhere(axisMatches(_, "y"))
    val z = axes.indexWhere(axisMatches(_, "z"))
    for {
      _ <- bool2Fox(x >= 0 && y >= 0 && z >= 0) ?~> s"invalid axis order: $x,$y,$z"
    } yield AxisOrder(x, y, z)
  }

  private def magFromTransforms(coordinateTransformations: List[OmeNgffCoordinateTransformation],
                                voxelSize: Vec3Double,
                                axisOrder: AxisOrder)(implicit ec: ExecutionContext): Fox[Vec3Int] = {
    val combinedScale = extractAndCombineScaleTransforms(coordinateTransformations, axisOrder)
    val mag = (combinedScale / voxelSize).round.toVec3Int
    for {
      _ <- bool2Fox(isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x)) ?~> s"invalid mag: $mag"
    } yield mag
  }

  private def isPowerOfTwo(x: Int): Boolean = x != 0 && (x & (x - 1)) == 0

  private def extractVoxelSize(allCoordinateTransformations: List[List[OmeNgffCoordinateTransformation]],
                               axisOrder: AxisOrder)(implicit ec: ExecutionContext): Fox[Vec3Double] = {
    val scales = allCoordinateTransformations.map(t => extractAndCombineScaleTransforms(t, axisOrder))
    val smallestScaleIsUniform = scales.minBy(_.x) == scales.minBy(_.y) && scales.minBy(_.y) == scales.minBy(_.z)
    for {
      _ <- bool2Fox(smallestScaleIsUniform) ?~> "ome scales do not agree on smallest dimension"
    } yield scales.minBy(_.x)
  }

  private def extractAndCombineScaleTransforms(coordinateTransformations: List[OmeNgffCoordinateTransformation],
                                               axisOrder: AxisOrder): Vec3Double = {
    val filtered = coordinateTransformations.filter(_.`type` == "scale")
    val xFactors = filtered.map(_.scale(axisOrder.x))
    val yFactors = filtered.map(_.scale(axisOrder.y))
    val zFactors = filtered.map(_.scale(axisOrder.z))
    Vec3Double(xFactors.product, yFactors.product, zFactors.product)
  }
}
