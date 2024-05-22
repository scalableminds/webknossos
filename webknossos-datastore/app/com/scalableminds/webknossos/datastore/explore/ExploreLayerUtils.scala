package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Header
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedHeader
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffGroupHeader, NgffMetadata, ZarrHeader}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader
import com.scalableminds.webknossos.datastore.models.datasource.{
  CoordinateTransformation,
  CoordinateTransformationType,
  DataLayerWithMagLocators
}

import scala.concurrent.ExecutionContext
import scala.util.Try

trait ExploreLayerUtils extends FoxImplicits {

  def adaptLayersAndVoxelSize(layersWithVoxelSizes: List[(DataLayerWithMagLocators, Vec3Double)],
                              preferredVoxelSize: Option[Vec3Double])(
      implicit ec: ExecutionContext): Fox[(List[DataLayerWithMagLocators], Vec3Double)] =
    for {
      rescaledLayersAndVoxelSize <- rescaleLayersByCommonVoxelSize(layersWithVoxelSizes, preferredVoxelSize) ?~> "Could not extract common voxel size from layers"
      rescaledLayers = rescaledLayersAndVoxelSize._1
      voxelSize = rescaledLayersAndVoxelSize._2
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
                                                   preferredVoxelSize: Option[Vec3Double],
                                                   voxelSize: Vec3Double): List[DataLayerWithMagLocators] =
    layers.map(l => {
      val coordinateTransformations = coordinateTransformationForVoxelSize(voxelSize, preferredVoxelSize)
      l.mapped(coordinateTransformations = coordinateTransformations)
    })

  private def isPowerOfTwo(x: Int): Boolean =
    x != 0 && (x & (x - 1)) == 0

  private def isPowerOfTwo(x: Double): Boolean = {
    val epsilon = 0.0001
    val l = math.log(x) / math.log(2)
    math.abs(l - l.round.toDouble) < epsilon
  }

  private def magFromVoxelSize(minVoxelSize: Vec3Double, voxelSize: Vec3Double)(
      implicit ec: ExecutionContext): Fox[Vec3Int] = {

    val mag = (voxelSize / minVoxelSize).round.toVec3Int
    for {
      _ <- bool2Fox(isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x)) ?~> s"invalid mag: $mag. Must all be powers of two"
    } yield mag
  }

  private def checkForDuplicateMags(magGroup: List[Vec3Int])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- bool2Fox(magGroup.length == 1) ?~> s"detected mags are not unique, found $magGroup"
    } yield ()

  private def findBaseVoxelSize(minVoxelSize: Vec3Double, preferredVoxelSizeOpt: Option[Vec3Double]): Vec3Double =
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
      foundVoxelSize: Vec3Double,
      preferredVoxelSize: Option[Vec3Double]): Option[List[CoordinateTransformation]] =
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

  private def rescaleLayersByCommonVoxelSize(layersWithVoxelSizes: List[(DataLayerWithMagLocators, Vec3Double)],
                                             preferredVoxelSize: Option[Vec3Double])(
      implicit ec: ExecutionContext): Fox[(List[DataLayerWithMagLocators], Vec3Double)] = {
    val allVoxelSizes = layersWithVoxelSizes
      .flatMap(layerWithVoxelSize => {
        val layer = layerWithVoxelSize._1
        val voxelSize = layerWithVoxelSize._2

        layer.resolutions.map(resolution => voxelSize * resolution.toVec3Double)
      })
      .toSet
    val minVoxelSizeOpt = Try(allVoxelSizes.minBy(_.toTuple)).toOption

    for {
      minVoxelSize <- option2Fox(minVoxelSizeOpt)
      baseVoxelSize = findBaseVoxelSize(minVoxelSize, preferredVoxelSize)
      allMags <- Fox.combined(allVoxelSizes.map(magFromVoxelSize(baseVoxelSize, _)).toList) ?~> s"voxel sizes for layers are not uniform, got ${layersWithVoxelSizes
        .map(_._2)}"
      groupedMags = allMags.groupBy(_.maxDim)
      _ <- Fox.combined(groupedMags.values.map(checkForDuplicateMags).toList)
      rescaledLayers = layersWithVoxelSizes.map(layerWithVoxelSize => {
        val layer = layerWithVoxelSize._1
        val layerVoxelSize = layerWithVoxelSize._2
        val magFactors = (layerVoxelSize / baseVoxelSize).toVec3Int
        layer.mapped(boundingBoxMapping = _ * magFactors, magMapping = mag => mag.copy(mag = mag.mag * magFactors))
      })
    } yield (rescaledLayers, baseVoxelSize)
  }

  def removeHeaderFileNamesFromUriSuffix(uri: String): String =
    if (uri.endsWith(N5Header.FILENAME_ATTRIBUTES_JSON)) uri.dropRight(N5Header.FILENAME_ATTRIBUTES_JSON.length)
    else if (uri.endsWith(ZarrHeader.FILENAME_DOT_ZARRAY)) uri.dropRight(ZarrHeader.FILENAME_DOT_ZARRAY.length)
    else if (uri.endsWith(NgffMetadata.FILENAME_DOT_ZATTRS)) uri.dropRight(NgffMetadata.FILENAME_DOT_ZATTRS.length)
    else if (uri.endsWith(NgffGroupHeader.FILENAME_DOT_ZGROUP))
      uri.dropRight(NgffGroupHeader.FILENAME_DOT_ZGROUP.length)
    else if (uri.endsWith(PrecomputedHeader.FILENAME_INFO)) uri.dropRight(PrecomputedHeader.FILENAME_INFO.length)
    else if (uri.endsWith(Zarr3ArrayHeader.FILENAME_ZARR_JSON))
      uri.dropRight(Zarr3ArrayHeader.FILENAME_ZARR_JSON.length)
    else uri

}
