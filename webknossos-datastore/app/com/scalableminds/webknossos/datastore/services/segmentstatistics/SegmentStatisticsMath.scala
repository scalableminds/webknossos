package com.scalableminds.webknossos.datastore.services.segmentstatistics

import com.scalableminds.util.Msg
import com.scalableminds.util.box.Box
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}

object SegmentStatisticsMath {

  def rescaleVolumeToMag(volume: Long, fileMag: Vec3Int, requestedMag: Vec3Int): Long =
    if (fileMag == requestedMag) volume
    else volume * fileMag.product / requestedMag.product

  // The volume-weighted average of centerOfMasses, per dimension. Fails if the segments' total volume is zero.
  def weightedCenterOfMass(centerOfMasses: Seq[Array[Float]], volumes: Seq[Long]): Box[Array[Double]] =
    for {
      totalVolume = volumes.sum
      _ <- Box.fromBool(totalVolume > 0) ?~> Msg.SegmentStatisticsFile.combinedCenterOfMassZeroVolume
      combinedCenterOfMass = Array.tabulate(3) { dim =>
        val weightedSum = centerOfMasses
          .lazyZip(volumes)
          .map { case (centerOfMass, volume) =>
            centerOfMass(dim).toDouble * volume
          }
          .sum
        weightedSum / totalVolume
      }
    } yield combinedCenterOfMass

  /** Combines the covariance matrices of several (oversegmentation) segments into the covariance matrix of their union,
    * via the parallel axis theorem: each segment’s covariance is shifted from its own center of mass to the combined
    * center of mass (adding the outer product of that offset with itself), then volume-weighted-averaged. This is exact
    * (not an approximation), as long as the given segments are disjoint (do not overlap). If a single segment id is
    * given, this just returns its own covariance matrix. Fails if the segments' total volume is zero.
    */
  def combineCovarianceMatrices(
      covarianceMatrices: Seq[Array[Array[Float]]],
      centerOfMasses: Seq[Array[Float]],
      volumes: Seq[Long]
  ): Box[Array[Array[Float]]] =
    for {
      totalVolume = volumes.sum
      _ <- Box.fromBool(totalVolume > 0) ?~> Msg.SegmentStatisticsFile.combinedCovarianceMatrixZeroVolume
      combinedCenterOfMass <- weightedCenterOfMass(centerOfMasses, volumes)
      combinedCovarianceMatrix = Array.tabulate(3, 3) { (i, j) =>
        val weightedSum = covarianceMatrices.indices.map { idx =>
          val volume = volumes(idx)
          val covariance = covarianceMatrices(idx)(i)(j).toDouble
          val offsetI = centerOfMasses(idx)(i).toDouble - combinedCenterOfMass(i)
          val offsetJ = centerOfMasses(idx)(j).toDouble - combinedCenterOfMass(j)
          volume * (covariance + offsetI * offsetJ)
        }.sum
        (weightedSum / totalVolume).toFloat
      }
    } yield combinedCovarianceMatrix

  /** The sphericity as in segment statistics files (voxelytics): π^(1/3) · (6 · volume)^(2/3) / area, i.e. 1 for a ball
    * and smaller for other shapes. voxelSize is the size of a voxel in the mag the voxels were counted in. 0 for a
    * segment without surface.
    */
  def sphericity(surfaceArea: Double, voxelCount: Long, voxelSize: Vec3Double): Double =
    if (surfaceArea <= 0) 0.0
    else {
      val volume = voxelCount * voxelSize.x * voxelSize.y * voxelSize.z
      Math.cbrt(Math.PI) * Math.pow(6 * volume, 2.0 / 3.0) / surfaceArea
    }

}
