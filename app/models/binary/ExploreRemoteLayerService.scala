package models.binary

import java.net.URI
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.dataformats.zarr._
import com.scalableminds.webknossos.datastore.jzarr._
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.{Json, OFormat, Reads}

import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

case class ExploreRemoteDatasetParameters(remoteUri: String, user: Option[String], password: Option[String])
object ExploreRemoteDatasetParameters {
  implicit val jsonFormat: OFormat[ExploreRemoteDatasetParameters] = Json.format[ExploreRemoteDatasetParameters]
}

case class MagWithAttributes(mag: ZarrMag, remotePath: Path, elementClass: ElementClass.Value, boundingBox: BoundingBox)

class ExploreRemoteLayerService @Inject()() extends FoxImplicits with LazyLogging {

  def exploreRemoteDatasource(
      urisWithCredentials: List[ExploreRemoteDatasetParameters],
      reportMutable: ListBuffer[String])(implicit ec: ExecutionContext): Fox[GenericDataSource[DataLayer]] =
    for {
      exploredLayersNested <- Fox.serialCombined(urisWithCredentials)(parameters =>
        exploreRemoteLayersForUri(parameters.remoteUri, parameters.user, parameters.password, reportMutable))
      layersWithVoxelSizes = exploredLayersNested.flatten
      _ <- bool2Fox(layersWithVoxelSizes.nonEmpty) ?~> "Detected zero layers"
      voxelSize <- commonVoxelSize(layersWithVoxelSizes.map(_._2)) ?~> "Could not extract common voxel size from layers"
      layers = makeLayerNamesUnique(layersWithVoxelSizes.map(_._1))
      dataSetName <- dataSetName(urisWithCredentials.map(_.remoteUri))
      dataSource = GenericDataSource[DataLayer](
        DataSourceId(dataSetName, ""),
        layers,
        voxelSize
      )
    } yield dataSource

  private def makeLayerNamesUnique(layers: List[ZarrLayer]): List[ZarrLayer] = {
    val namesSetMutable = scala.collection.mutable.Set[String]()
    layers.map { layer: ZarrLayer =>
      var nameCandidate = layer.name
      var index = 1
      while (namesSetMutable.contains(nameCandidate)) {
        index += 1
        nameCandidate = f"${layer.name}_$index"
      }
      namesSetMutable.add(nameCandidate)
      if (nameCandidate == layer.name) {
        layer
      } else
        layer match {
          case l: ZarrDataLayer         => l.copy(name = nameCandidate)
          case l: ZarrSegmentationLayer => l.copy(name = nameCandidate)
        }
    }
  }

  private def dataSetName(uris: List[String])(implicit ec: ExecutionContext): Fox[String] =
    if (uris.length == 1) uris.headOption.map(normalizeUri(_).split("/").last).toFox
    else Fox.successful("explored_remote_dataset")

  private def commonVoxelSize(voxelSizes: List[Vec3Double])(implicit ec: ExecutionContext): Fox[Vec3Double] =
    for {
      head <- voxelSizes.headOption.toFox
      _ <- bool2Fox(voxelSizes.forall(_ == head)) ?~> s"voxel sizes for layers are not uniform, got $voxelSizes"
    } yield head

  private def exploreRemoteLayersForUri(
      layerUri: String,
      user: Option[String],
      password: Option[String],
      reportMutable: ListBuffer[String])(implicit ec: ExecutionContext): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      remoteSource <- tryo(RemoteSourceDescriptor(new URI(normalizeUri(layerUri)), user, password)).toFox ?~> s"Received invalid URI: $layerUri"
      fileSystem <- FileSystemsHolder.getOrCreate(remoteSource).toFox ?~> "Failed to set up remote file system"
      remotePath <- tryo(fileSystem.getPath(remoteSource.remotePath)) ?~> "Failed to get remote path"
      layersWithVoxelSizes <- exploreAsArrayOrNgff(remotePath, remoteSource.credentials, reportMutable)
    } yield layersWithVoxelSizes

  private def normalizeUri(uri: String): String =
    if (uri.endsWith(ZarrHeader.FILENAME_DOT_ZARRAY)) uri.dropRight(ZarrHeader.FILENAME_DOT_ZARRAY.length)
    else if (uri.endsWith(OmeNgffHeader.FILENAME_DOT_ZATTRS)) uri.dropRight(OmeNgffHeader.FILENAME_DOT_ZATTRS.length)
    else if (uri.endsWith(OmeNgffGroupHeader.FILENAME_DOT_ZGROUP))
      uri.dropRight(OmeNgffGroupHeader.FILENAME_DOT_ZGROUP.length)
    else uri

  private def exploreAsArrayOrNgff(
      remotePath: Path,
      credentials: Option[FileSystemCredentials],
      reportMutable: ListBuffer[String])(implicit ec: ExecutionContext): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      _ <- Fox.successful(reportMutable += s"Trying to explore $remotePath as ZarrArray...")
      asArrayBox: Box[List[(ZarrLayer, Vec3Double)]] <- exploreAsZarrArray(remotePath, credentials).futureBox
      result <- asArrayBox match {
        case Full(asArrayResult) =>
          reportMutable += s"Found ZarrArray with name ${asArrayResult.headOption.map(_._1.name)} at $remotePath"
          Fox.successful(asArrayResult)
        case f: Failure =>
          reportMutable += s"Error when reading $remotePath as ZarrArray: ${formatFailureForReport(f)}"
          reportMutable += s"Trying to explore $remotePath as OME NGFF 0.4 multiscales group..."
          (for {
            asNgffBox <- exploreAsNgff(remotePath, credentials).futureBox
            result <- asNgffBox match {
              case Full(asNgffResult) =>
                reportMutable += s"Found multiscales group with layer names ${asNgffResult.map(_._1.name)} at $remotePath"
                Fox.successful(asNgffResult)
              case f2: Failure =>
                reportMutable += s"Error when reading $remotePath as multiscales group: ${formatFailureForReport(f2)}"
                Fox.successful(List.empty)
              case Empty => Fox.successful(List.empty)
            }
          } yield result).toFox
        case Empty => Fox.successful(List.empty)
      }
    } yield result

  def formatFailureForReport(failure: Failure): String = {
    def formatChain(chain: Box[Failure]): String = chain match {
      case Full(failure) =>
        " <~ " + failure.msg + formatChain(failure.chain)
      case _ => ""
    }
    failure.msg + formatChain(failure.chain)
  }

  private def exploreAsZarrArray(remotePath: Path, credentials: Option[FileSystemCredentials])(
      implicit ec: ExecutionContext): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      zarrayPath <- Fox.successful(remotePath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY))
      name <- guessNameFromPath(remotePath)
      zarrHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at $zarrayPath"
      elementClass <- zarrHeader.elementClass ?~> "failed to read element class from zarr header"
      guessedAxisOrder = AxisOrder.asZyxFromRank(zarrHeader.rank)
      boundingBox <- zarrHeader.boundingBox(guessedAxisOrder) ?~> "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format"
      zarrMag = ZarrMag(Vec3Int.ones, Some(remotePath.toString), credentials, Some(guessedAxisOrder))
      layer: ZarrLayer = if (looksLikeSegmentationLayer(name, elementClass)) {
        ZarrSegmentationLayer(name, boundingBox, elementClass, List(zarrMag), largestSegmentId = 0L)
      } else ZarrDataLayer(name, Category.color, boundingBox, elementClass, List(zarrMag))
    } yield List((layer, Vec3Double(1.0, 1.0, 1.0)))

  private def parseJsonFromPath[T: Reads](path: Path)(implicit ec: ExecutionContext): Fox[T] =
    for {
      fileAsString <- tryo(new String(Files.readAllBytes(path), StandardCharsets.UTF_8)).toFox ?~> "Failed to read remote file"
      parsed <- JsonHelper.parseJsonToFox[T](fileAsString) ?~> "Failed to validate json against data schema"
    } yield parsed

  private def exploreAsNgff(remotePath: Path, credentials: Option[FileSystemCredentials])(
      implicit ec: ExecutionContext): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      zattrsPath <- Fox.successful(remotePath.resolve(OmeNgffHeader.FILENAME_DOT_ZATTRS))
      ngffHeader <- parseJsonFromPath[OmeNgffHeader](zattrsPath) ?~> s"Failed to read OME NGFF header at $zattrsPath"
      layers <- Fox.serialCombined(ngffHeader.multiscales)(layerFromNgffMultiscale(_, remotePath, credentials))
    } yield layers

  private def layerFromNgffMultiscale(
      multiscale: OmeNgffOneHeader,
      remotePath: Path,
      credentials: Option[FileSystemCredentials])(implicit ec: ExecutionContext): Fox[(ZarrLayer, Vec3Double)] =
    for {
      axisOrder <- extractAxisOrder(multiscale.axes) ?~> "Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"
      axisUnitFactors <- extractAxisUnitFactors(multiscale.axes, axisOrder) ?~> "Could not extract axis unit-to-nm factors"
      voxelSizeInAxisUnits <- extractVoxelSizeInAxisUnits(
        multiscale.datasets.map(_.coordinateTransformations),
        axisOrder) ?~> "Could not extract voxel size from scale transforms"
      magsWithAttributes <- Fox.serialCombined(multiscale.datasets)(d =>
        zarrMagFromNgffDataset(d, remotePath, voxelSizeInAxisUnits, axisOrder, credentials))
      _ <- bool2Fox(magsWithAttributes.nonEmpty) ?~> "zero mags in layer"
      elementClass <- elementClassFromMags(magsWithAttributes) ?~> "Could not extract element class from mags"
      boundingBox = boundingBoxFromMags(magsWithAttributes)
      nameFromPath <- guessNameFromPath(remotePath)
      name = multiscale.name.getOrElse(nameFromPath)
      voxelSizeNanometers = voxelSizeInAxisUnits * axisUnitFactors
      layer: ZarrLayer = if (looksLikeSegmentationLayer(name, elementClass)) {
        ZarrSegmentationLayer(name, boundingBox, elementClass, magsWithAttributes.map(_.mag), largestSegmentId = 0L)
      } else ZarrDataLayer(name, Category.color, boundingBox, elementClass, magsWithAttributes.map(_.mag))
    } yield (layer, voxelSizeNanometers)

  private def zarrMagFromNgffDataset(
      ngffDataset: OmeNgffDataset,
      layerPath: Path,
      voxelSizeInAxisUnits: Vec3Double,
      axisOrder: AxisOrder,
      credentials: Option[FileSystemCredentials])(implicit ec: ExecutionContext): Fox[MagWithAttributes] =
    for {
      mag <- magFromTransforms(ngffDataset.coordinateTransformations, voxelSizeInAxisUnits, axisOrder) ?~> "Could not extract mag from scale transforms"
      magPath = layerPath.resolve(ngffDataset.path)
      zarrayPath = magPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)
      zarrHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at $zarrayPath"
      elementClass <- zarrHeader.elementClass ?~> s"failed to read element class from zarr header at $zarrayPath"
      boundingBox <- zarrHeader.boundingBox(axisOrder) ?~> s"failed to read bounding box from zarr header at $zarrayPath"
    } yield
      MagWithAttributes(ZarrMag(mag, Some(magPath.toString), credentials, Some(axisOrder)),
                        magPath,
                        elementClass,
                        boundingBox)

  private def elementClassFromMags(magsWithAttributes: List[MagWithAttributes])(
      implicit ec: ExecutionContext): Fox[ElementClass.Value] = {
    val elementClasses = magsWithAttributes.map(_.elementClass)
    for {
      head <- elementClasses.headOption.toFox
      _ <- bool2Fox(elementClasses.forall(_ == head)) ?~> s"Element class must be the same for all mags of a layer. got $elementClasses"
    } yield head
  }

  private def boundingBoxFromMags(magsWithAttributes: List[MagWithAttributes]): BoundingBox =
    BoundingBox.union(magsWithAttributes.map(_.boundingBox))

  private def guessNameFromPath(path: Path)(implicit ec: ExecutionContext): Fox[String] =
    path.toString.split("/").lastOption.toFox

  private def extractAxisOrder(axes: List[OmeNgffAxis])(implicit ec: ExecutionContext): Fox[AxisOrder] = {
    def axisMatches(axis: OmeNgffAxis, name: String) = axis.name.toLowerCase == name && axis.`type` == "space"
    val x = axes.indexWhere(axisMatches(_, "x"))
    val y = axes.indexWhere(axisMatches(_, "y"))
    val z = axes.indexWhere(axisMatches(_, "z"))
    val c = axes.indexWhere(_.`type` == "channel")
    val cOpt = if (c == -1) None else Some(c)
    for {
      _ <- bool2Fox(x >= 0 && y >= 0 && z >= 0) ?~> s"invalid xyz axis order: $x,$y,$z."
    } yield AxisOrder(x, y, z, cOpt)
  }

  private def extractAxisUnitFactors(axes: List[OmeNgffAxis], axisOrder: AxisOrder)(
      implicit ec: ExecutionContext): Fox[Vec3Double] =
    for {
      xUnitFactor <- axes(axisOrder.x).spaceUnitToNmFactor
      yUnitFactor <- axes(axisOrder.y).spaceUnitToNmFactor
      zUnitFactor <- axes(axisOrder.z).spaceUnitToNmFactor
    } yield Vec3Double(xUnitFactor, yUnitFactor, zUnitFactor)

  private def magFromTransforms(coordinateTransforms: List[OmeNgffCoordinateTransformation],
                                voxelSizeInAxisUnits: Vec3Double,
                                axisOrder: AxisOrder)(implicit ec: ExecutionContext): Fox[Vec3Int] = {
    def isPowerOfTwo(x: Int): Boolean =
      x != 0 && (x & (x - 1)) == 0

    val combinedScale = extractAndCombineScaleTransforms(coordinateTransforms, axisOrder)
    val mag = (combinedScale / voxelSizeInAxisUnits).round.toVec3Int
    for {
      _ <- bool2Fox(isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x)) ?~> s"invalid mag: $mag. Must all be powers of two"
    } yield mag
  }

  /*
   * Guesses the voxel size from all transforms of an ngff multiscale object.
   * Note: the returned voxel size is in axis units and should later be combined with those units
   *   to get a webKnossos-typical voxel size in nanometers.
   * Note: allCoordinateTransforms is nested: the inner list has all transforms of one ngff “dataset” (mag in our terminology),
   *   the outer list gathers these for all such “datasets” (mags) of one “multiscale object” (layer)
   */
  private def extractVoxelSizeInAxisUnits(allCoordinateTransforms: List[List[OmeNgffCoordinateTransformation]],
                                          axisOrder: AxisOrder)(implicit ec: ExecutionContext): Fox[Vec3Double] = {
    val scales = allCoordinateTransforms.map(t => extractAndCombineScaleTransforms(t, axisOrder))
    val smallestScaleIsUniform = scales.minBy(_.x) == scales.minBy(_.y) && scales.minBy(_.y) == scales.minBy(_.z)
    for {
      _ <- bool2Fox(smallestScaleIsUniform) ?~> "ngff scales do not agree on smallest dimension"
      voxelSizeInAxisUnits = scales.minBy(_.x)
    } yield voxelSizeInAxisUnits
  }

  private def extractAndCombineScaleTransforms(coordinateTransforms: List[OmeNgffCoordinateTransformation],
                                               axisOrder: AxisOrder): Vec3Double = {
    val filtered = coordinateTransforms.filter(_.`type` == "scale")
    val xFactors = filtered.map(_.scale(axisOrder.x))
    val yFactors = filtered.map(_.scale(axisOrder.y))
    val zFactors = filtered.map(_.scale(axisOrder.z))
    Vec3Double(xFactors.product, yFactors.product, zFactors.product)
  }

  private def looksLikeSegmentationLayer(layerName: String, elementClass: ElementClass.Value) =
    Set("segmentation", "labels").contains(layerName.toLowerCase) && ElementClass.segmentationElementClasses.contains(
      elementClass)

}
