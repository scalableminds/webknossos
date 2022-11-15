package models.binary.explore

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.zarr.{
  FileSystemCredentials,
  ZarrDataLayer,
  ZarrLayer,
  ZarrSegmentationLayer
}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr._
import com.scalableminds.webknossos.datastore.models.datasource.{Category, ElementClass}

import java.nio.file.Path
import scala.concurrent.ExecutionContext.Implicits.global

class NgffExplorer extends RemoteLayerExplorer {

  override def name: String = "OME NGFF Zarr v0.4"

  override def explore(remotePath: Path,
                       credentials: Option[FileSystemCredentials]): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      zattrsPath <- Fox.successful(remotePath.resolve(NgffMetadata.FILENAME_DOT_ZATTRS))
      ngffHeader <- parseJsonFromPath[NgffMetadata](zattrsPath) ?~> s"Failed to read OME NGFF header at $zattrsPath"
      labelLayers <- exploreLabelLayers(remotePath, credentials)

      layerLists: List[List[(ZarrLayer, Vec3Double)]] <- Fox.serialCombined(ngffHeader.multiscales)(multiscale => {
        for {
          channelCount: Int <- getNgffMultiscaleChannelCount(multiscale, remotePath)
          layers <- layersFromNgffMultiscale(multiscale, remotePath, credentials, channelCount)
        } yield layers
      })
      layers: List[(ZarrLayer, Vec3Double)] = layerLists.flatten
    } yield layers ++ labelLayers

  private def getNgffMultiscaleChannelCount(multiscale: NgffMultiscalesItem, remotePath: Path): Fox[Int] =
    for {
      firstDataset <- multiscale.datasets.headOption.toFox
      magPath = remotePath.resolve(firstDataset.path)
      zarrayPath = magPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)
      zarrHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at $zarrayPath"
      axisOrder <- extractAxisOrder(multiscale.axes) ?~> "Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"
      channelCount = axisOrder.c match {
        case Some(channeAxislIndex) => zarrHeader.shape(channeAxislIndex)
        case _                      => 1
      }
    } yield channelCount

  private def layersFromNgffMultiscale(multiscale: NgffMultiscalesItem,
                                       remotePath: Path,
                                       credentials: Option[FileSystemCredentials],
                                       channelCount: Int,
                                       isSegmentation: Boolean = false): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      axisOrder <- extractAxisOrder(multiscale.axes) ?~> "Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"
      axisUnitFactors <- extractAxisUnitFactors(multiscale.axes, axisOrder) ?~> "Could not extract axis unit-to-nm factors"
      voxelSizeInAxisUnits <- extractVoxelSizeInAxisUnits(
        multiscale.datasets.map(_.coordinateTransformations),
        axisOrder) ?~> "Could not extract voxel size from scale transforms"
      voxelSizeNanometers = voxelSizeInAxisUnits * axisUnitFactors
      nameFromPath <- guessNameFromPath(remotePath)
      name = multiscale.name.getOrElse(nameFromPath)
      layerTuples <- Fox.serialCombined((0 until channelCount).toList)({ channelIndex: Int =>
        for {
          magsWithAttributes <- Fox.serialCombined(multiscale.datasets)(d =>
            zarrMagFromNgffDataset(d, remotePath, voxelSizeInAxisUnits, axisOrder, credentials, Some(channelIndex)))
          _ <- bool2Fox(magsWithAttributes.nonEmpty) ?~> "zero mags in layer"
          elementClassRaw <- elementClassFromMags(magsWithAttributes) ?~> "Could not extract element class from mags"
          elementClass = if (isSegmentation) ensureElementClassForSegmentationLayer(elementClassRaw)
          else elementClassRaw
          boundingBox = boundingBoxFromMags(magsWithAttributes)
          layer: ZarrLayer = if (looksLikeSegmentationLayer(name, elementClass) || isSegmentation) {
            ZarrSegmentationLayer(name,
                                  boundingBox,
                                  elementClass,
                                  magsWithAttributes.map(_.mag),
                                  largestSegmentId = None)
          } else ZarrDataLayer(name, Category.color, boundingBox, elementClass, magsWithAttributes.map(_.mag))
        } yield (layer, voxelSizeNanometers)
      })
    } yield layerTuples

  private def exploreLabelLayers(remotePath: Path,
                                 credentials: Option[FileSystemCredentials]): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      labelDescriptionPath <- Fox.successful(remotePath.resolve(NgffLabelsGroup.LABEL_PATH))
      labelGroup <- parseJsonFromPath[NgffLabelsGroup](labelDescriptionPath)
      layerTuples <- Fox.serialCombined(labelGroup.labels) { labelPath =>
        layersForLabel(remotePath, labelPath, credentials)
      }
    } yield layerTuples.flatten

  private def layersForLabel(remotePath: Path,
                                labelPath: String,
                                credentials: Option[FileSystemCredentials]): Fox[List[(ZarrLayer, Vec3Double)]] =
    for {
      fullLabelPath <- Fox.successful(remotePath.resolve("labels").resolve(labelPath))
      zattrsPath = fullLabelPath.resolve(NgffMetadata.FILENAME_DOT_ZATTRS)
      ngffHeader <- parseJsonFromPath[NgffMetadata](zattrsPath) ?~> s"Failed to read OME NGFF header at $zattrsPath"
      layers: List[List[(ZarrLayer, Vec3Double)]] <- Fox.serialCombined(ngffHeader.multiscales)(
        multiscale =>
          layersFromNgffMultiscale(multiscale.copy(name = Some(s"labels-$labelPath")),
                                   fullLabelPath,
                                   credentials,
                                   1,
                                   isSegmentation = true))
    } yield layers.flatten

  private def ensureElementClassForSegmentationLayer(e: ElementClass.Value): ElementClass.Value =
    e match {
      case ElementClass.int8  => ElementClass.uint8
      case ElementClass.int16 => ElementClass.uint16
      case ElementClass.int32 => ElementClass.uint32
      case ElementClass.int64 => ElementClass.uint64
      case _                  => e
    }

  private def zarrMagFromNgffDataset(ngffDataset: NgffDataset,
                                     layerPath: Path,
                                     voxelSizeInAxisUnits: Vec3Double,
                                     axisOrder: AxisOrder,
                                     credentials: Option[FileSystemCredentials],
                                     channelIndex: Option[Int]): Fox[MagWithAttributes] =
    for {
      mag <- magFromTransforms(ngffDataset.coordinateTransformations, voxelSizeInAxisUnits, axisOrder) ?~> "Could not extract mag from scale transforms"
      magPath = layerPath.resolve(ngffDataset.path)
      zarrayPath = magPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)
      zarrHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at $zarrayPath"
      elementClass <- zarrHeader.elementClass ?~> s"failed to read element class from zarr header at $zarrayPath"
      boundingBox <- zarrHeader.boundingBox(axisOrder) ?~> s"failed to read bounding box from zarr header at $zarrayPath"
    } yield
      MagWithAttributes(MagLocator(mag, Some(magPath.toString), credentials, Some(axisOrder), channelIndex),
                        magPath,
                        elementClass,
                        boundingBox)

  private def extractAxisOrder(axes: List[NgffAxis]): Fox[AxisOrder] = {
    def axisMatches(axis: NgffAxis, name: String) = axis.name.toLowerCase == name && axis.`type` == "space"

    val x = axes.indexWhere(axisMatches(_, "x"))
    val y = axes.indexWhere(axisMatches(_, "y"))
    val z = axes.indexWhere(axisMatches(_, "z"))
    val c = axes.indexWhere(_.`type` == "channel")
    val cOpt = if (c == -1) None else Some(c)
    for {
      _ <- bool2Fox(x >= 0 && y >= 0 && z >= 0) ?~> s"invalid xyz axis order: $x,$y,$z."
    } yield AxisOrder(x, y, z, cOpt)
  }

  private def extractAxisUnitFactors(axes: List[NgffAxis], axisOrder: AxisOrder): Fox[Vec3Double] =
    for {
      xUnitFactor <- axes(axisOrder.x).spaceUnitToNmFactor
      yUnitFactor <- axes(axisOrder.y).spaceUnitToNmFactor
      zUnitFactor <- axes(axisOrder.z).spaceUnitToNmFactor
    } yield Vec3Double(xUnitFactor, yUnitFactor, zUnitFactor)

  private def magFromTransforms(coordinateTransforms: List[NgffCoordinateTransformation],
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
  private def extractVoxelSizeInAxisUnits(allCoordinateTransforms: List[List[NgffCoordinateTransformation]],
                                          axisOrder: AxisOrder): Fox[Vec3Double] = {
    val scales = allCoordinateTransforms.map(t => extractAndCombineScaleTransforms(t, axisOrder))
    val smallestScaleIsUniform = scales.minBy(_.x) == scales.minBy(_.y) && scales.minBy(_.y) == scales.minBy(_.z)
    for {
      _ <- bool2Fox(smallestScaleIsUniform) ?~> "ngff scales do not agree on smallest dimension"
      voxelSizeInAxisUnits = scales.minBy(_.x)
    } yield voxelSizeInAxisUnits
  }

  private def extractAndCombineScaleTransforms(coordinateTransforms: List[NgffCoordinateTransformation],
                                               axisOrder: AxisOrder): Vec3Double = {
    val filtered = coordinateTransforms.filter(_.`type` == "scale")
    val scalesFromTransforms = filtered.flatMap(_.scale)
    val xFactors = scalesFromTransforms.map(_(axisOrder.x))
    val yFactors = scalesFromTransforms.map(_(axisOrder.y))
    val zFactors = scalesFromTransforms.map(_(axisOrder.z))
    Vec3Double(xFactors.product, yFactors.product, zFactors.product)
  }
}
