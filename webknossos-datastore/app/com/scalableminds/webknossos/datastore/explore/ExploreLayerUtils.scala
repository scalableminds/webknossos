package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Header
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedHeader
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffGroupHeader, NgffMetadata, ZarrHeader}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.{
  CoordinateTransformation,
  CoordinateTransformationType,
  DataLayerWithMagLocators
}

import scala.concurrent.ExecutionContext
import scala.util.Try

trait ExploreLayerUtils extends FoxImplicits {

  def adaptLayersAndVoxelSize(layersWithVoxelSizes: List[(DataLayerWithMagLocators, VoxelSize)],
                              preferredVoxelSize: Option[VoxelSize])(
      implicit ec: ExecutionContext): Fox[(List[DataLayerWithMagLocators], VoxelSize)] =
    for {
      (rescaledLayers, voxelSize) <- rescaleLayersByCommonVoxelSize(layersWithVoxelSizes, preferredVoxelSize) ?~> "Could not extract common voxel size from layers"
      renamedLayers = makeLayerNamesUnique(rescaledLayers)
      layersWithCoordinateTransformations = addCoordinateTransformationsToLayers(renamedLayers,
                                                                                 preferredVoxelSize,
                                                                                 voxelSize)
    } yield (layersWithCoordinateTransformations, voxelSize)

  def makeLayerNamesUnique(layers: List[DataLayerWithMagLocators]): List[DataLayerWithMagLocators] = {
    val namesSetMutable = scala.collection.mutable.Set[String]()
    layers.map { layer =>
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
        layer.mapped(name = nameCandidate)
    }
  }

  private def addCoordinateTransformationsToLayers(layers: List[DataLayerWithMagLocators],
                                                   preferredVoxelSize: Option[VoxelSize],
                                                   voxelSize: VoxelSize): List[DataLayerWithMagLocators] =
    layers.map(l => {
      val generatedCoordinateTransformation = coordinateTransformationForVoxelSize(voxelSize, preferredVoxelSize)
      l.mapped(coordinateTransformations = generatedCoordinateTransformation.orElse(l.coordinateTransformations))
    })

  private def isPowerOfTwo(x: Int): Boolean =
    x != 0 && (x & (x - 1)) == 0

  private def isPowerOfTwo(x: Double): Boolean = {
    val epsilon = 0.0001
    val l = math.log(x) / math.log(2)
    math.abs(l - l.round.toDouble) < epsilon
  }

  private def magFromVoxelSize(minVoxelSize: VoxelSize, voxelSize: VoxelSize)(
      implicit ec: ExecutionContext): Fox[Vec3Int] = {

    val mag = (voxelSize / minVoxelSize).round.toVec3Int
    for {
      _ <- bool2Fox(isPowerOfTwo(mag.x) && isPowerOfTwo(mag.y) && isPowerOfTwo(mag.z)) ?~> s"invalid mag: $mag. Must all be powers of two"
    } yield mag
  }

  private def checkForDuplicateMags(magGroup: List[Vec3Int])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- bool2Fox(magGroup.length == 1) ?~> s"detected mags are not unique, found $magGroup"
    } yield ()

  private def findBaseVoxelSize(minVoxelSize: VoxelSize, preferredVoxelSizeOpt: Option[VoxelSize]): VoxelSize =
    preferredVoxelSizeOpt match {
      case Some(preferredVoxelSize) =>
        val baseMag = minVoxelSize / preferredVoxelSize
        if (isPowerOfTwo(baseMag.x) && isPowerOfTwo(baseMag.y) && isPowerOfTwo(baseMag.z)) {
          preferredVoxelSize
        } else {
          minVoxelSize
        }
      case None => minVoxelSize
    }

  private def coordinateTransformationForVoxelSize(
      foundVoxelSize: VoxelSize,
      preferredVoxelSize: Option[VoxelSize]): Option[List[CoordinateTransformation]] =
    preferredVoxelSize match {
      case None => None
      case Some(voxelSize) =>
        if (voxelSize == foundVoxelSize) {
          None
        } else {
          val scale = foundVoxelSize / voxelSize
          Some(
            List(
              CoordinateTransformation(CoordinateTransformationType.affine,
                                       matrix = Some(
                                         List(
                                           List(scale.x, 0, 0, 0),
                                           List(0, scale.y, 0, 0),
                                           List(0, 0, scale.z, 0),
                                           List(0, 0, 0, 1)
                                         )))))
        }
    }

  private def rescaleLayersByCommonVoxelSize(layersWithVoxelSizes: List[(DataLayerWithMagLocators, VoxelSize)],
                                             preferredVoxelSize: Option[VoxelSize])(
      implicit ec: ExecutionContext): Fox[(List[DataLayerWithMagLocators], VoxelSize)] = {
    val allVoxelSizes = layersWithVoxelSizes.flatMap {
      case (layer, voxelSize) =>
        layer.resolutions.map(mag => voxelSize * mag.toVec3Double)
    }.toSet
    val minVoxelSizeOpt = Try(allVoxelSizes.minBy(_.toNanometer.toTuple)).toOption

    for {
      minVoxelSize <- option2Fox(minVoxelSizeOpt)
      baseVoxelSize = findBaseVoxelSize(minVoxelSize, preferredVoxelSize)
      allMags <- Fox.combined(allVoxelSizes.map(magFromVoxelSize(baseVoxelSize, _)).toList) ?~> s"voxel sizes for layers are not uniform, got ${layersWithVoxelSizes
        .map(_._2)}"
      groupedMags = allMags.groupBy(_.maxDim)
      _ <- Fox.combined(groupedMags.values.map(checkForDuplicateMags).toList)
      rescaledLayers = layersWithVoxelSizes.map {
        case (layer, layerVoxelSize) =>
          val magFactors = (layerVoxelSize / baseVoxelSize).toVec3Int
          layer.mapped(boundingBoxMapping = _ * magFactors, magMapping = mag => mag.copy(mag = mag.mag * magFactors))
      }
    } yield (rescaledLayers, baseVoxelSize)
  }

  def removeHeaderFileNamesFromUriSuffix(uri: String): String =
    uri
      .stripSuffix(N5Header.FILENAME_ATTRIBUTES_JSON)
      .stripSuffix(ZarrHeader.FILENAME_DOT_ZARRAY)
      .stripSuffix(NgffMetadata.FILENAME_DOT_ZATTRS)
      .stripSuffix(NgffGroupHeader.FILENAME_DOT_ZGROUP)
      .stripSuffix(PrecomputedHeader.FILENAME_INFO)
      .stripSuffix(Zarr3ArrayHeader.FILENAME_ZARR_JSON)

  def removeNeuroglancerPrefixesFromUri(uri: String): String =
    uri.stripPrefix("zarr3://").stripPrefix("zarr://").stripPrefix("precomputed://").stripPrefix("n5://")

}
