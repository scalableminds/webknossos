package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{
  PrecomputedDataLayer,
  PrecomputedLayer,
  PrecomputedSegmentationLayer
}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.precomputed.{PrecomputedHeader, PrecomputedScale}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.{
  Category,
  DatasetLayerAttachments,
  ElementClass,
  LayerAttachment,
  LayerAttachmentDataformat
}
import com.scalableminds.webknossos.datastore.services.mesh.{NeuroglancerMesh, NeuroglancerPrecomputedMeshInfo}

import scala.concurrent.ExecutionContext

class PrecomputedExplorer(implicit val ec: ExecutionContext) extends RemoteLayerExplorer with FoxImplicits {
  override def name: String = "Neuroglancer Precomputed"

  override def explore(remotePath: VaultPath, credentialId: Option[String])(
      implicit tc: TokenContext): Fox[List[(PrecomputedLayer, VoxelSize)]] =
    for {
      infoPath <- Fox.successful(remotePath / PrecomputedHeader.FILENAME_INFO)
      precomputedHeader <- infoPath
        .parseAsJson[PrecomputedHeader] ?~> s"Failed to read neuroglancer precomputed metadata at $infoPath"
      layerAndVoxelSize <- layerFromPrecomputedHeader(precomputedHeader, remotePath, credentialId)
    } yield List(layerAndVoxelSize)

  private def layerFromPrecomputedHeader(
      precomputedHeader: PrecomputedHeader,
      remotePath: VaultPath,
      credentialId: Option[String])(implicit tc: TokenContext): Fox[(PrecomputedLayer, VoxelSize)] =
    for {
      name <- Fox.successful(guessNameFromPath(remotePath))
      firstScale <- precomputedHeader.scales.headOption.toFox
      boundingBox <- BoundingBox
        .fromTopLeftAndSize(firstScale.voxel_offset.getOrElse(Array(0, 0, 0)), firstScale.size.map(_.toInt))
        .toFox
      elementClass: ElementClass.Value <- elementClassFromPrecomputedDataType(precomputedHeader.data_type).toFox ?~> s"Unknown data type ${precomputedHeader.data_type}"
      smallestResolution = firstScale.resolution
      voxelSize <- Vec3Double.fromArray(smallestResolution).toFox
      mags: List[MagLocator] <- Fox.serialCombined(precomputedHeader.scales)(
        getMagFromScale(_, smallestResolution, remotePath, credentialId).toFox)
      meshAttachments <- exploreMeshesForLayer(remotePath / precomputedHeader.meshPath)
      attachmentsGrouped = if (meshAttachments.nonEmpty) Some(DatasetLayerAttachments(meshes = meshAttachments))
      else None
      layer = if (precomputedHeader.describesSegmentationLayer) {
        PrecomputedSegmentationLayer(name,
                                     boundingBox,
                                     elementClass,
                                     mags,
                                     largestSegmentId = None,
                                     attachments = attachmentsGrouped)
      } else
        PrecomputedDataLayer(name, boundingBox, Category.color, elementClass, mags)
    } yield (layer, VoxelSize.fromFactorWithDefaultUnit(voxelSize))

  private def elementClassFromPrecomputedDataType(precomputedDataType: String): Option[ElementClass.Value] =
    precomputedDataType.toLowerCase match {
      case "uint8"   => Some(ElementClass.uint8)
      case "uint16"  => Some(ElementClass.uint16)
      case "uint32"  => Some(ElementClass.uint32)
      case "uint64"  => Some(ElementClass.uint64)
      case "float32" => Some(ElementClass.float)
      case _         => None
    }

  private def getMagFromScale(scale: PrecomputedScale,
                              minimalResolution: Array[Double],
                              remotePath: VaultPath,
                              credentialId: Option[String]): Option[MagLocator] = {
    val normalizedResolution = scale.resolution.zip(minimalResolution).map { case (r, m) => (r / m).toInt }
    for {
      mag <- Vec3Int.fromList(normalizedResolution.toList)
      path = remotePath / scale.key

      // Neuroglancer precomputed specification does not specify axis order, but uses x,y,z implicitly.
      // https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/volume.md#unsharded-chunk-storage
      axisOrder = AxisOrder.xyz(0, 1, 2)
    } yield MagLocator(mag, Some(path.toString), None, Some(axisOrder), channelIndex = None, credentialId)
  }

  private def exploreMeshesForLayer(meshPath: VaultPath)(implicit tc: TokenContext): Fox[Seq[LayerAttachment]] =
    (for {
      meshInfo <- (meshPath / NeuroglancerMesh.FILENAME_INFO)
        .parseAsJson[NeuroglancerPrecomputedMeshInfo] ?~> "Failed to read mesh info"
      _ <- Fox.fromBool(meshInfo.transform.length == 12) ?~> "Invalid mesh info: transform has to be of length 12"
    } yield
      Seq(
        LayerAttachment(NeuroglancerMesh.meshName, meshPath.toUri, LayerAttachmentDataformat.neuroglancerPrecomputed)))
      .orElse(Fox.successful(Seq.empty))
}
