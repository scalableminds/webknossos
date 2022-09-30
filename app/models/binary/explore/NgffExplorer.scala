package models.binary.explore

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.zarr.{
  FileSystemCredentials,
  ZarrDataLayer,
  ZarrLayer,
  ZarrSegmentationLayer
}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.jzarr._
import com.scalableminds.webknossos.datastore.models.datasource.{Category, ElementClass}

import java.nio.file.Path
import scala.concurrent.ExecutionContext.Implicits.global

class NgffExplorer extends RemoteLayerExplorer {

  override def name: String = "OME NGFF Zarr v0.4"

  override def explore(remotePath: Path,
                       credentials: Option[FileSystemCredentials]): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      zattrsPath <- Fox.successful(remotePath.resolve(OmeNgffHeader.FILENAME_DOT_ZATTRS))
      ngffHeader <- parseJsonFromPath[OmeNgffHeader](zattrsPath) ?~> s"Failed to read OME NGFF header at $zattrsPath"
      layers <- Fox.serialCombined(ngffHeader.multiscales)(layerFromNgffMultiscale(_, remotePath, credentials))
    } yield layers

  private def layerFromNgffMultiscale(multiscale: OmeNgffOneHeader,
                                      remotePath: Path,
                                      credentials: Option[FileSystemCredentials]): Fox[(ZarrLayer, Vec3Double)] =
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
        ZarrSegmentationLayer(name, boundingBox, elementClass, magsWithAttributes.map(_.mag), largestSegmentId = None)
      } else ZarrDataLayer(name, Category.color, boundingBox, elementClass, magsWithAttributes.map(_.mag))
    } yield (layer, voxelSizeNanometers)

  private def zarrMagFromNgffDataset(ngffDataset: OmeNgffDataset,
                                     layerPath: Path,
                                     voxelSizeInAxisUnits: Vec3Double,
                                     axisOrder: AxisOrder,
                                     credentials: Option[FileSystemCredentials]): Fox[MagWithAttributes] =
    for {
      mag <- magFromTransforms(ngffDataset.coordinateTransformations, voxelSizeInAxisUnits, axisOrder) ?~> "Could not extract mag from scale transforms"
      magPath = layerPath.resolve(ngffDataset.path)
      zarrayPath = magPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)
      zarrHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at $zarrayPath"
      elementClass <- zarrHeader.elementClass ?~> s"failed to read element class from zarr header at $zarrayPath"
      boundingBox <- zarrHeader.boundingBox(axisOrder) ?~> s"failed to read bounding box from zarr header at $zarrayPath"
    } yield
      MagWithAttributes(MagLocator(mag, Some(magPath.toString), credentials, Some(axisOrder)),
                        magPath,
                        elementClass,
                        boundingBox)

  private def elementClassFromMags(magsWithAttributes: List[MagWithAttributes]): Fox[ElementClass.Value] = {
    val elementClasses = magsWithAttributes.map(_.elementClass)
    for {
      head <- elementClasses.headOption.toFox
      _ <- bool2Fox(elementClasses.forall(_ == head)) ?~> s"Element class must be the same for all mags of a layer. got $elementClasses"
    } yield head
  }

  private def boundingBoxFromMags(magsWithAttributes: List[MagWithAttributes]): BoundingBox =
    BoundingBox.union(magsWithAttributes.map(_.boundingBox))

  private def extractAxisOrder(axes: List[OmeNgffAxis]): Fox[AxisOrder] = {
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

  private def extractAxisUnitFactors(axes: List[OmeNgffAxis], axisOrder: AxisOrder): Fox[Vec3Double] =
    for {
      xUnitFactor <- axes(axisOrder.x).spaceUnitToNmFactor
      yUnitFactor <- axes(axisOrder.y).spaceUnitToNmFactor
      zUnitFactor <- axes(axisOrder.z).spaceUnitToNmFactor
    } yield Vec3Double(xUnitFactor, yUnitFactor, zUnitFactor)

  private def magFromTransforms(coordinateTransforms: List[OmeNgffCoordinateTransformation],
                                voxelSizeInAxisUnits: Vec3Double,
                                axisOrder: AxisOrder): Fox[Vec3Int] = {
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
                                          axisOrder: AxisOrder): Fox[Vec3Double] = {
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
}
