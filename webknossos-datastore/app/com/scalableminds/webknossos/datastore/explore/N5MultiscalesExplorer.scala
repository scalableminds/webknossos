package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{N5DataLayer, N5Layer, N5SegmentationLayer}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.n5._
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.Category
import net.liftweb.common.Box.tryo

import scala.concurrent.ExecutionContext

class N5MultiscalesExplorer(implicit val ec: ExecutionContext) extends RemoteLayerExplorer with FoxImplicits {

  override def name: String = "N5 Multiscales"

  override def explore(remotePath: VaultPath, credentialId: Option[String])(
      implicit tc: TokenContext): Fox[List[(N5Layer, VoxelSize)]] =
    for {
      metadataPath <- Fox.successful(remotePath / N5Metadata.FILENAME_ATTRIBUTES_JSON)
      n5Metadata <- metadataPath.parseAsJson[N5Metadata] ?~> s"Failed to read N5 header at $metadataPath"
      layers <- Fox.serialCombined(n5Metadata.multiscales)(layerFromN5MultiscalesItem(_, remotePath, credentialId))
    } yield layers

  private def layerFromN5MultiscalesItem(
      multiscalesItem: N5MultiscalesItem,
      remotePath: VaultPath,
      credentialId: Option[String])(implicit tc: TokenContext): Fox[(N5Layer, VoxelSize)] =
    for {
      voxelSizeNanometers <- extractVoxelSize(multiscalesItem.datasets.map(_.transform))
      magsWithAttributes <- Fox.serialCombined(multiscalesItem.datasets)(d =>
        n5MagFromDataset(d, remotePath, voxelSizeNanometers, credentialId))
      _ <- bool2Fox(magsWithAttributes.nonEmpty) ?~> "zero mags in layer"
      elementClass <- elementClassFromMags(magsWithAttributes) ?~> "Could not extract element class from mags"
      boundingBox = boundingBoxFromMags(magsWithAttributes)
      name = guessNameFromPath(remotePath)
      layer: N5Layer = if (looksLikeSegmentationLayer(name, elementClass)) {
        N5SegmentationLayer(name, boundingBox, elementClass, magsWithAttributes.map(_.mag), largestSegmentId = None)
      } else N5DataLayer(name, Category.color, boundingBox, elementClass, magsWithAttributes.map(_.mag))
    } yield (layer, VoxelSize.fromFactorWithDefaultUnit(voxelSizeNanometers))

  private def extractAxisOrder(axes: List[String]): Fox[AxisOrder] = {
    val x = axes.indexWhere(_ == "x")
    val y = axes.indexWhere(_ == "y")
    val z = axes.indexWhere(_ == "z")
    val c = axes.indexWhere(_ == "c")

    val cOpt = if (c == -1) None else Some(c)
    for {
      _ <- bool2Fox(x >= 0 && y >= 0 && z >= 0) ?~> s"invalid xyz axis order: $x,$y,$z."
    } yield AxisOrder(x, y, Some(z), cOpt)
  }

  private def extractAxisUnitFactors(unitsOpt: Option[List[String]], axisOrder: AxisOrder): Fox[Vec3Double] =
    unitsOpt match {
      case Some(units) =>
        for {
          xUnitFactor <- spaceUnitToNmFactor(units(axisOrder.x))
          yUnitFactor <- spaceUnitToNmFactor(units(axisOrder.y))
          zUnitFactor <- spaceUnitToNmFactor(units(axisOrder.zWithFallback))
        } yield Vec3Double(xUnitFactor, yUnitFactor, zUnitFactor)
      case None => Fox.successful(Vec3Double(1e3, 1e3, 1e3)) // assume default micrometers
    }

  private def spaceUnitToNmFactor(unit: String): Fox[Double] =
    unit.toLowerCase match {
      case "ym"        => Fox.successful(1e-15)
      case "zm"        => Fox.successful(1e-12)
      case "am"        => Fox.successful(1e-9)
      case "fm"        => Fox.successful(1e-6)
      case "pm"        => Fox.successful(1e-3)
      case "nm"        => Fox.successful(1.0)
      case "µm"        => Fox.successful(1e3)
      case "um"        => Fox.successful(1e3)
      case "mm"        => Fox.successful(1e6)
      case "cm"        => Fox.successful(1e7)
      case "dm"        => Fox.successful(1e8)
      case "m"         => Fox.successful(1e9)
      case ""          => Fox.successful(1e3) // default is micrometers
      case unknownUnit => Fox.failure(s"Unknown space axis unit: $unknownUnit")
    }

  private def extractVoxelSize(transforms: List[N5Transform]): Fox[Vec3Double] =
    for {
      voxelSizes <- Fox.serialCombined(transforms)(t => voxelSizeFromTransform(t))
    } yield voxelSizes.minBy(_.maxDim)

  private def voxelSizeFromTransform(transform: N5Transform): Fox[Vec3Double] =
    for {
      axisOrder <- extractAxisOrder(transform.axes) ?~> "Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"
      axisUnitFactors <- extractAxisUnitFactors(transform.units, axisOrder) ?~> "Could not extract axis unit-to-nm factors"
      voxelSizeInAxisUnits <- extractVoxelSizeInAxisUnits(transform.scale, axisOrder) ?~> "Could not extract voxel size from scale transforms"
    } yield voxelSizeInAxisUnits * axisUnitFactors

  private def extractVoxelSizeInAxisUnits(scale: List[Double], axisOrder: AxisOrder): Fox[Vec3Double] =
    tryo(Vec3Double(scale(axisOrder.x), scale(axisOrder.y), scale(axisOrder.zWithFallback)))

  private def n5MagFromDataset(n5Dataset: N5MultiscalesDataset,
                               layerPath: VaultPath,
                               voxelSize: Vec3Double,
                               credentialId: Option[String])(implicit tc: TokenContext): Fox[MagWithAttributes] =
    for {
      axisOrder <- extractAxisOrder(n5Dataset.transform.axes) ?~> "Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"
      mag <- magFromTransform(voxelSize, n5Dataset.transform) ?~> "Could not extract mag from transforms"
      magPath = layerPath / n5Dataset.path
      headerPath = magPath / N5Header.FILENAME_ATTRIBUTES_JSON
      n5Header <- headerPath.parseAsJson[N5Header] ?~> s"failed to read n5 header at $headerPath"
      elementClass <- n5Header.elementClass ?~> s"failed to read element class from n5 header at $headerPath"
      boundingBox <- n5Header.boundingBox(axisOrder) ?~> s"failed to read bounding box from n5 header at $headerPath"
    } yield
      MagWithAttributes(MagLocator(mag, Some(magPath.toUri.toString), None, Some(axisOrder), None, credentialId),
                        magPath,
                        elementClass,
                        boundingBox)

  private def magFromTransform(voxelSize: Vec3Double, transform: N5Transform): Fox[Vec3Int] = {
    def isPowerOfTwo(x: Int): Boolean =
      x != 0 && (x & (x - 1)) == 0

    for {
      magVoxelSize <- voxelSizeFromTransform(transform)
      mag = (magVoxelSize / voxelSize).round.toVec3Int
      _ <- bool2Fox(isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x)) ?~> s"invalid mag: $mag. Must all be powers of two"
    } yield mag
  }

}
