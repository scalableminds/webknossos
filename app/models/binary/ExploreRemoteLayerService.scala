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
  OmeNgffHeader,
  ZarrHeader
}
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayer}
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import net.liftweb.common.Box
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.Reads

import scala.concurrent.ExecutionContext

case class AxisOrder(x: Int, y: Int, z: Int)

class ExploreRemoteLayerService @Inject()() extends FoxImplicits with LazyLogging {

  def exploreRemoteLayer(layerUri: String)(implicit ec: ExecutionContext): Fox[DataLayer] = {
    val uri = new URI(layerUri)
    val remoteSource = RemoteSourceDescriptor(uri, None, None)
    for {
      fileSystem <- FileSystemsHolder.getOrCreate(remoteSource).toFox ?~> "failed to get file system"
      remotePath <- tryo(fileSystem.getPath(remoteSource.remotePath)) ?~> "failed to get remote path"
      //dataLayer <- exploreAsZarrArray(remotePath)
      dataLayer <- exploreAsOmeNgff(remotePath)
    } yield dataLayer
  }

  private def exploreAsZarrArray(remotePath: Path)(implicit ec: ExecutionContext): Fox[DataLayer] =
    for {
      zarrayPath <- Fox.successful(guessZarrayPath(remotePath))
      zarrHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at ${zarrayPath}"
      _ = logger.info(zarrHeader.toString)
      elementClass <- zarrHeader.elementClass
      boundingBox <- zarrHeader.boundingBox
      zarrMag = ZarrMag(Vec3Int.ones, Some(remotePath.toString), credentials = None)
    } yield ZarrDataLayer(guessNameFromPath(remotePath), Category.color, boundingBox, elementClass, List(zarrMag))

  private def parseJsonFromPath[T: Reads](path: Path): Box[T] = {
    val fileAsString = new String(Files.readAllBytes(path), StandardCharsets.UTF_8)
    JsonHelper.parseJsonToFox[T](fileAsString)
  }

  private def guessZarrayPath(layerPath: Path): Path =
    if (layerPath.endsWith(ZarrHeader.FILENAME_DOT_ZARRAY)) layerPath
    else layerPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)

  private def guessZattrsPath(layerPath: Path): Path =
    if (layerPath.endsWith(OmeNgffHeader.FILENAME_DOT_ZATTRS)) layerPath
    else layerPath.resolve(OmeNgffHeader.FILENAME_DOT_ZATTRS)

  private def exploreAsOmeNgff(remotePath: Path)(implicit ec: ExecutionContext): Fox[DataLayer] =
    for {
      zattrsPath <- Fox.successful(guessZattrsPath(remotePath))
      omeNgffHeader <- parseJsonFromPath[OmeNgffHeader](zattrsPath) ?~> s"failed to read ome ngff header at ${zattrsPath}"
      _ = if (omeNgffHeader.multiscales.length > 1) {
        logger.info("Found multiple multiscale images in ngff header. using first.")
      }
      firstMultiscale <- omeNgffHeader.multiscales.headOption.toFox
      axisOrder = extractAxisOrder(firstMultiscale.axes)
      voxelSize = extractVoxelSize(firstMultiscale.datasets.map(_.coordinateTransformations), axisOrder)
      mags = firstMultiscale.datasets.map(
        d =>
          ZarrMag(magFromTransforms(d.coordinateTransformations, voxelSize, axisOrder),
                  Some(remotePath.resolve(d.path).toString),
                  None))
      firstMag <- mags.headOption.toFox
      firstMagPath <- firstMultiscale.datasets.headOption.map(d => remotePath.resolve(d.path)).toFox
      zarrHeader <- parseJsonFromPath[ZarrHeader](firstMagPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)).toFox
      elementClass <- zarrHeader.elementClass.toFox
      boundingBox <- zarrHeader.boundingBox.toFox
      _ <- Fox.successful(logger.info(f"OMG: $omeNgffHeader"))
    } yield
      ZarrDataLayer(firstMultiscale.name.getOrElse(guessNameFromPath(remotePath)),
                    Category.color,
                    boundingBox,
                    elementClass,
                    List(firstMag))

  private def guessNameFromPath(path: Path): String =
    "explored_remote_dataset" // TODO

  private def extractAxisOrder(axes: List[OmeNgffAxis]): AxisOrder = {
    def axisMatches(axis: OmeNgffAxis, name: String) = axis.name.toLowerCase == "x" && axis.`type` == "space"
    val x = axes.indexWhere(axisMatches(_, "x"))
    val y = axes.indexWhere(axisMatches(_, "y"))
    val z = axes.indexWhere(axisMatches(_, "z"))
    // todo assert none are -1
    AxisOrder(x, y, z)
  }

  private def magFromTransforms(coordinateTransformations: List[OmeNgffCoordinateTransformation],
                                voxelSize: Vec3Double,
                                axisOrder: AxisOrder): Vec3Int = {
    val combinedScale = extractAndCombineScaleTransforms(coordinateTransformations, axisOrder)
    (combinedScale / voxelSize).toVec3Int // todo round properly?
    // assert valid mag
  }

  private def extractVoxelSize(allCoordinateTransformations: List[List[OmeNgffCoordinateTransformation]],
                               axisOrder: AxisOrder): Vec3Double = {
    val scales: List[Vec3Double] = allCoordinateTransformations.map(t => extractAndCombineScaleTransforms(t, axisOrder))
    val smallestScaleIsUniform = scales.minBy(_.x) == scales.minBy(_.y) && scales.minBy(_.y) == scales.minBy(_.z) // TODO assert
    scales.minBy(_.x)
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
