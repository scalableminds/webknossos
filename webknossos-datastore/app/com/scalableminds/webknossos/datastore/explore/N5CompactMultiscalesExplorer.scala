package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.n5.{N5CompactMultiscalesMetadata, N5Header, N5Metadata}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.DataLayerWithMagLocators
import com.scalableminds.util.tools.Box.tryo

import scala.concurrent.ExecutionContext

class N5CompactMultiscalesExplorer(implicit val ec: ExecutionContext) extends N5Explorer with FoxImplicits {

  override def name: String = "N5 Multiscales with compact metadata"

  override def explore(remotePath: VaultPath, credentialId: Option[String])(
      implicit tc: TokenContext): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      metadataPath <- Fox.successful(remotePath / N5Metadata.FILENAME_ATTRIBUTES_JSON)
      n5Metadata <- metadataPath
        .parseAsJson[N5CompactMultiscalesMetadata] ?~> s"Failed to read N5 header at $metadataPath"
      _ <- Fox.fromBool(n5Metadata.multiScale.contains(true)) ?~> s"N5 header at $metadataPath does not have multiScale=true"
      axisOrder <- extractAxisOrder(n5Metadata.axes.getOrElse(List("x", "y", "z")))
      downsamplingFactors <- n5Metadata.downsamplingFactors
        .orElse(n5Metadata.scales)
        .toFox ?~> s"N5 header at $metadataPath does not have downsamplingFactors/scales"
      voxelSize <- extractVoxelSize(axisOrder, n5Metadata)
      magsWithAttributes <- Fox.serialCombined(downsamplingFactors.zipWithIndex) {
        case (downsamplingFactor, magIndex) =>
          n5magFromDownsamplingFactor(downsamplingFactor, magIndex, axisOrder, remotePath, credentialId)
      }
      _ <- Fox.fromBool(magsWithAttributes.nonEmpty) ?~> "zero mags in layer"
      layer <- layerFromMagsWithAttributes(magsWithAttributes, remotePath)
    } yield List((layer, voxelSize))

  private def extractVoxelSize(axisOrder: AxisOrder, n5Metadata: N5CompactMultiscalesMetadata): Fox[VoxelSize] =
    for {
      axisUnitFactors <- extractAxisUnitFactors(n5Metadata.units, axisOrder) ?~> "Could not extract axis unit-to-nm factors"
      voxelSizeInAxisUnits <- extractVoxelSizeInAxisUnits(n5Metadata.resolution, axisOrder) ?~> "Could not extract voxel size from scale transforms"
      voxelSizeNanometers = voxelSizeInAxisUnits * axisUnitFactors
      voxelSize = VoxelSize.fromFactorWithDefaultUnit(voxelSizeNanometers)
    } yield voxelSize

  private def n5magFromDownsamplingFactor(
      downsamplingFactor: List[Int],
      magIndex: Int,
      axisOrder: AxisOrder,
      remotePath: VaultPath,
      credentialId: Option[String])(implicit ec: ExecutionContext, tc: TokenContext): Fox[MagWithAttributes] =
    for {
      mag <- tryo(
        Vec3Int(downsamplingFactor(axisOrder.x),
                downsamplingFactor(axisOrder.y),
                downsamplingFactor(axisOrder.zWithFallback))).toFox
      magPath = remotePath / s"s$magIndex"
      headerPath = magPath / N5Header.FILENAME_ATTRIBUTES_JSON
      n5Header <- headerPath.parseAsJson[N5Header] ?~> s"failed to read n5 header at $headerPath"
      elementClass <- n5Header.elementClass.toFox ?~> s"failed to read element class from n5 header at $headerPath"
      boundingBox <- n5Header
        .boundingBox(axisOrder)
        .toFox ?~> s"failed to read bounding box from n5 header at $headerPath"
    } yield
      MagWithAttributes(MagLocator(mag, Some(magPath.toUri.toString), None, Some(axisOrder), None, credentialId),
                        magPath,
                        elementClass,
                        boundingBox)

}
