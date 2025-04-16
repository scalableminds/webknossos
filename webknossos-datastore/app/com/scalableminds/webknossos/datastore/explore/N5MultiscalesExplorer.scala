package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.N5Layer
import com.scalableminds.webknossos.datastore.datareaders.n5._
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize

import scala.concurrent.ExecutionContext

class N5MultiscalesExplorer(implicit val ec: ExecutionContext) extends N5Explorer with FoxImplicits {

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
      layer <- layerFromMagsWithAttributes(magsWithAttributes, remotePath)
    } yield (layer, VoxelSize.fromFactorWithDefaultUnit(voxelSizeNanometers))

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

  private def magFromTransform(voxelSize: Vec3Double, transform: N5Transform): Fox[Vec3Int] =
    for {
      magVoxelSize <- voxelSizeFromTransform(transform)
      mag = (magVoxelSize / voxelSize).round.toVec3Int
      _ <- bool2Fox(mag.isAllPowersOfTwo) ?~> s"invalid mag: $mag. Must all be powers of two"
    } yield mag

}
