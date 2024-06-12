package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{
  PrecomputedDataLayer,
  PrecomputedLayer,
  PrecomputedSegmentationLayer
}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.precomputed.{PrecomputedHeader, PrecomputedScale}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.{Category, ElementClass}

import scala.concurrent.ExecutionContext

class PrecomputedExplorer(implicit val ec: ExecutionContext) extends RemoteLayerExplorer {
  override def name: String = "Neuroglancer Precomputed"

  override def explore(remotePath: VaultPath, credentialId: Option[String]): Fox[List[(PrecomputedLayer, Vec3Double)]] =
    for {
      infoPath <- Fox.successful(remotePath / PrecomputedHeader.FILENAME_INFO)
      precomputedHeader <- parseJsonFromPath[PrecomputedHeader](infoPath) ?~> s"Failed to read neuroglancer precomputed metadata at $infoPath"
      layerAndVoxelSize <- layerFromPrecomputedHeader(precomputedHeader, remotePath, credentialId)
    } yield List(layerAndVoxelSize)

  private def layerFromPrecomputedHeader(precomputedHeader: PrecomputedHeader,
                                         remotePath: VaultPath,
                                         credentialId: Option[String]): Fox[(PrecomputedLayer, Vec3Double)] =
    for {
      name <- Fox.successful(guessNameFromPath(remotePath))
      firstScale <- precomputedHeader.scales.headOption.toFox
      boundingBox <- BoundingBox
        .fromTopLeftAndSize(firstScale.voxel_offset.getOrElse(Array(0, 0, 0)), firstScale.size)
        .toFox
      elementClass: ElementClass.Value <- elementClassFromPrecomputedDataType(precomputedHeader.data_type) ?~> "Unknown data type"
      smallestResolution = firstScale.resolution
      voxelSize <- Vec3Double.fromArray(smallestResolution).toFox
      mags: List[MagLocator] <- Fox.serialCombined(precomputedHeader.scales)(
        getMagFromScale(_, smallestResolution, remotePath, credentialId))
      layer = if (precomputedHeader.describesSegmentationLayer) {
        PrecomputedSegmentationLayer(name, boundingBox, elementClass, mags, None)
      } else PrecomputedDataLayer(name, boundingBox, Category.color, elementClass, mags)
    } yield (layer, voxelSize)

  private def elementClassFromPrecomputedDataType(precomputedDataType: String): Fox[ElementClass.Value] =
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
                              credentialId: Option[String]): Fox[MagLocator] = {
    val normalizedResolution = scale.resolution.zip(minimalResolution).map { case (r, m) => (r / m).toInt }
    for {
      mag <- Vec3Int.fromList(normalizedResolution.toList)
      path = remotePath / scale.key

      // Neuroglancer precomputed specification does not specify axis order, but uses x,y,z implicitly.
      // https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/volume.md#unsharded-chunk-storage
      axisOrder = AxisOrder.xyz(0, 1, 2)
    } yield MagLocator(mag, Some(path.toString), None, Some(axisOrder), channelIndex = None, credentialId)
  }
}
