package models.binary

import java.net.URI
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.dataformats.zarr.{
  RemoteSourceDescriptor,
  ZarrDataLayer,
  ZarrLayer,
  ZarrMag
}
import com.scalableminds.webknossos.datastore.jzarr.{
  OmeNgffAxis,
  OmeNgffCoordinateTransformation,
  OmeNgffDataset,
  OmeNgffHeader,
  OmeNgffOneHeader,
  ZarrHeader
}
import com.scalableminds.webknossos.datastore.models.datasource.{
  Category,
  DataLayer,
  DataSourceId,
  ElementClass,
  GenericDataSource
}
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import net.liftweb.common.{Box, Full}
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.{Json, OFormat, Reads}

import scala.concurrent.ExecutionContext

case class ExploreRemoteDatasetParameters(remoteUri: String, user: Option[String], password: Option[String])
object ExploreRemoteDatasetParameters {
  implicit val jsonFormat: OFormat[ExploreRemoteDatasetParameters] = Json.format[ExploreRemoteDatasetParameters]
}

case class AxisOrder(x: Int, y: Int, z: Int)
case class MagWithAttributes(mag: ZarrMag, remotePath: Path, elementClass: ElementClass.Value, boundingBox: BoundingBox)

class ExploreRemoteLayerService @Inject()() extends FoxImplicits with LazyLogging {

  def exploreRemoteDatasource(urisWithCredentials: List[ExploreRemoteDatasetParameters])(
      implicit ec: ExecutionContext): Fox[GenericDataSource[DataLayer]] =
    for {
      exploredLayersNested <- Fox.serialCombined(urisWithCredentials)(parameters =>
        exploreRemoteLayers(parameters.remoteUri, parameters.user, parameters.password))
      layersWithVoxelSizes = exploredLayersNested.flatten
      voxelSize <- extractVoxelSize(layersWithVoxelSizes.map(_._2))
      dataSetName <- dataSetName(urisWithCredentials.map(_.remoteUri))
      dataSource = GenericDataSource[DataLayer](DataSourceId(dataSetName, ""),
                                                layersWithVoxelSizes.map(_._1),
                                                voxelSize)
    } yield dataSource

  def dataSetName(uris: List[String])(implicit ec: ExecutionContext): Fox[String] =
    if (uris.length == 1) uris.headOption.map(_.split("/").last).toFox
    else Fox.successful("explored_remote_dataset")

  def extractVoxelSize(voxelSizes: List[Vec3Double])(implicit ec: ExecutionContext): Fox[Vec3Double] =
    for {
      head <- voxelSizes.headOption.toFox
      _ <- bool2Fox(voxelSizes.forall(_ == head))
    } yield head

  def exploreRemoteLayers(layerUri: String, user: Option[String], password: Option[String])(
      implicit ec: ExecutionContext): Fox[List[(ZarrLayer, Vec3Double)]] = {
    val uri = new URI(layerUri)
    val remoteSource = RemoteSourceDescriptor(uri, user, password)
    for {
      fileSystem <- FileSystemsHolder.getOrCreate(remoteSource).toFox ?~> "failed to get file system"
      remotePath <- tryo(fileSystem.getPath(remoteSource.remotePath)) ?~> "failed to get remote path"
      layersWithVoxelSizes <- exploreAsArrayOrNgff(remotePath)
    } yield layersWithVoxelSizes
  }

  private def exploreAsArrayOrNgff(remotePath: Path)(
      implicit ec: ExecutionContext): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      asArrayBox <- exploreAsZarrArray(remotePath).futureBox
      result <- asArrayBox match {
        case Full(asArrayResult) => Fox.successful(asArrayResult)
        case _                   => exploreAsOmeNgff(remotePath)
      }
    } yield result

  private def exploreAsZarrArray(remotePath: Path)(implicit ec: ExecutionContext): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      zarrayPath <- Fox.successful(guessZarrayPath(remotePath))
      name <- guessNameFromPath(remotePath)
      zarrHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at $zarrayPath"
      elementClass <- zarrHeader.elementClass
      boundingBox <- zarrHeader.boundingBox
      zarrMag = ZarrMag(Vec3Int.ones, Some(remotePath.toString), credentials = None)
    } yield
      List((ZarrDataLayer(name, Category.color, boundingBox, elementClass, List(zarrMag)), Vec3Double(1.0, 1.0, 1.0)))

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

  private def exploreAsOmeNgff(remotePath: Path)(implicit ec: ExecutionContext): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      zattrsPath <- Fox.successful(guessZattrsPath(remotePath))
      omeNgffHeader <- parseJsonFromPath[OmeNgffHeader](zattrsPath) ?~> s"failed to read ome ngff header at $zattrsPath"
      _ <- Fox.successful(logger.info(f"OMG: $omeNgffHeader"))
      layers <- Fox.serialCombined(omeNgffHeader.multiscales)(layerFromMultiscale(_, remotePath))
    } yield layers

  private def layerFromMultiscale(multiscale: OmeNgffOneHeader, remotePath: Path)(
      implicit ec: ExecutionContext): Fox[(ZarrLayer, Vec3Double)] =
    for {
      axisOrder <- extractAxisOrder(multiscale.axes)
      axisUnitFactors <- extractAxisUnitFactors(multiscale.axes, axisOrder)
      voxelSizeInAxisUnits <- extractVoxelSize(multiscale.datasets.map(_.coordinateTransformations),
                                               axisOrder,
                                               axisUnitFactors)
      magsWithAttributes <- Fox.serialCombined(multiscale.datasets)(d =>
        zarrMagFromNgffDataset(d, remotePath, voxelSizeInAxisUnits, axisOrder))
      _ <- bool2Fox(magsWithAttributes.nonEmpty) ?~> "zero mags in layer"
      elementClass <- elementClassFromMags(magsWithAttributes) ?~> "Could not extract element class from mags"
      boundingBox = boundingBoxFromMags(magsWithAttributes)
      name <- guessNameFromPath(remotePath)
      voxelSizeNm = voxelSizeInAxisUnits * axisUnitFactors
    } yield
      (ZarrDataLayer(
         multiscale.name.getOrElse(name),
         Category.color,
         boundingBox,
         elementClass,
         magsWithAttributes.map(_.mag)
       ),
       voxelSizeNm)

  private def zarrMagFromNgffDataset(dataset: OmeNgffDataset,
                                     layerPath: Path,
                                     voxelSizeInAxisUnits: Vec3Double,
                                     axisOrder: AxisOrder)(implicit ec: ExecutionContext): Fox[MagWithAttributes] =
    for {
      mag <- magFromTransforms(dataset.coordinateTransformations, voxelSizeInAxisUnits, axisOrder)
      path = layerPath.resolve(dataset.path)
      zarrHeader <- parseJsonFromPath[ZarrHeader](path.resolve(ZarrHeader.FILENAME_DOT_ZARRAY))
      elementClass <- zarrHeader.elementClass
      boundingBox <- zarrHeader.boundingBox
    } yield
      MagWithAttributes(ZarrMag(mag, Some(path.toString), None), // TODO insert credentials
                        path,
                        elementClass,
                        boundingBox)

  private def elementClassFromMags(magsWithAttributes: List[MagWithAttributes])(
      implicit ec: ExecutionContext): Fox[ElementClass.Value] = {
    val elementClasses = magsWithAttributes.map(_.elementClass)
    for {
      head <- elementClasses.headOption.toFox
      _ <- bool2Fox(elementClasses.forall(_ == head))
    } yield head
  }

  private def boundingBoxFromMags(magsWithAttributes: List[MagWithAttributes]): BoundingBox =
    BoundingBox.combine(magsWithAttributes.map(_.boundingBox))

  private def guessNameFromPath(path: Path)(implicit ec: ExecutionContext): Fox[String] =
    path.toString.split("/").lastOption.toFox

  private def extractAxisOrder(axes: List[OmeNgffAxis])(implicit ec: ExecutionContext): Fox[AxisOrder] = {
    def axisMatches(axis: OmeNgffAxis, name: String) = axis.name.toLowerCase == name && axis.`type` == "space"
    val x = axes.indexWhere(axisMatches(_, "x"))
    val y = axes.indexWhere(axisMatches(_, "y"))
    val z = axes.indexWhere(axisMatches(_, "z"))
    for {
      _ <- bool2Fox(x >= 0 && y >= 0 && z >= 0) ?~> s"invalid axis order: $x,$y,$z"
      _ <- bool2Fox(z == axes.length - 3 && y == axes.length - 2 && x == axes.length - 1) ?~> s"currently, wk supports only axis order where z,y,x are the last three axes. got z$z,y$y,x$x, count=${axes.length}"
    } yield AxisOrder(x, y, z)
  }

  private def extractAxisUnitFactors(axes: List[OmeNgffAxis], axisOrder: AxisOrder)(
      implicit ec: ExecutionContext): Fox[Vec3Double] =
    for {
      xUnitFactor <- axes(axisOrder.x).spaceUnitToNmFactor
      yUnitFactor <- axes(axisOrder.y).spaceUnitToNmFactor
      zUnitFactor <- axes(axisOrder.z).spaceUnitToNmFactor
    } yield Vec3Double(xUnitFactor, yUnitFactor, zUnitFactor)

  private def magFromTransforms(coordinateTransformations: List[OmeNgffCoordinateTransformation],
                                voxelSizeInAxisUnits: Vec3Double,
                                axisOrder: AxisOrder)(implicit ec: ExecutionContext): Fox[Vec3Int] = {
    val combinedScale = extractAndCombineScaleTransforms(coordinateTransformations, axisOrder)
    val mag = (combinedScale / voxelSizeInAxisUnits).round.toVec3Int
    for {
      _ <- bool2Fox(isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x)) ?~> s"invalid mag: $mag"
    } yield mag
  }

  private def isPowerOfTwo(x: Int): Boolean = x != 0 && (x & (x - 1)) == 0

  private def extractVoxelSize(allCoordinateTransformations: List[List[OmeNgffCoordinateTransformation]],
                               axisOrder: AxisOrder,
                               axisUnitFactors: Vec3Double)(implicit ec: ExecutionContext): Fox[Vec3Double] = {
    val scales = allCoordinateTransformations.map(t => extractAndCombineScaleTransforms(t, axisOrder))
    val smallestScaleIsUniform = scales.minBy(_.x) == scales.minBy(_.y) && scales.minBy(_.y) == scales.minBy(_.z)
    for {
      _ <- bool2Fox(smallestScaleIsUniform) ?~> "ome scales do not agree on smallest dimension"
      voxelSizeInAxisUnits = scales.minBy(_.x)
      voxelSize = voxelSizeInAxisUnits * axisUnitFactors
    } yield voxelSize
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
