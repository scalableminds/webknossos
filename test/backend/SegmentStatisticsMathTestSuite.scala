package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.services.segmentstatistics.SegmentStatisticsMath
import org.scalatest.wordspec.AsyncWordSpec

class SegmentStatisticsMathTestSuite extends AsyncWordSpec {

  private val epsilon = 1e-3

  // Population mean/covariance (divide by n, not n-1) of a raw point set, used as ground truth to verify the
  // segment-wise combination formulas against a direct computation over the union of the segments' points.
  private def meanOf(points: Seq[Array[Double]]): Array[Double] =
    Array.tabulate(3)(dim => points.map(_(dim)).sum / points.length)

  private def covarianceOf(points: Seq[Array[Double]], mean: Array[Double]): Array[Array[Double]] =
    Array.tabulate(3, 3) { (i, j) =>
      points.map(p => (p(i) - mean(i)) * (p(j) - mean(j))).sum / points.length
    }

  private def toFloatArray(a: Array[Double]): Array[Float] = a.map(_.toFloat)
  private def toFloatMatrix(a: Array[Array[Double]]): Array[Array[Float]] = a.map(_.map(_.toFloat))

  "rescaleVolumeToMag" should {
    "leave the volume unchanged when file and requested mag are the same" in
      assert(SegmentStatisticsMath.rescaleVolumeToMag(123L, Vec3Int(2, 2, 2), Vec3Int(2, 2, 2)) == 123L)
    "scale down a voxel count for an isotropically coarser requested mag" in
      // requested mag is 2x coarser in every dimension, so voxels are 8x larger, i.e. 8x fewer of them
      assert(SegmentStatisticsMath.rescaleVolumeToMag(800L, Vec3Int(1, 1, 1), Vec3Int(2, 2, 2)) == 100L)
    "scale down a voxel count for an anisotropically coarser requested mag" in
      // requested mag is 2x coarser in x and y only, so voxels are 4x larger, i.e. 4x fewer of them
      assert(SegmentStatisticsMath.rescaleVolumeToMag(400L, Vec3Int(1, 1, 1), Vec3Int(2, 2, 1)) == 100L)
  }

  "weightedCenterOfMass" should {
    "fail when the total volume of the segments is zero" in {
      val combined = SegmentStatisticsMath.weightedCenterOfMass(Seq(Array(1.0f, 2.0f, 3.0f)), Seq(0L))
      assert(combined.isEmpty)
    }
    "return the segment's own center of mass for a single segment" in {
      val center = Array(1.0f, 2.0f, 3.0f)
      val combined = SegmentStatisticsMath.weightedCenterOfMass(Seq(center), Seq(42L)).toOption.get
      for (dim <- 0 until 3) assert(Math.abs(combined(dim) - center(dim)) < epsilon)
      succeed
    }
    "average two equally-sized segments evenly" in {
      val centerA = Array(0.0f, 0.0f, 0.0f)
      val centerB = Array(10.0f, 0.0f, 0.0f)
      val combined = SegmentStatisticsMath.weightedCenterOfMass(Seq(centerA, centerB), Seq(5L, 5L)).toOption.get
      assert(Math.abs(combined(0) - 5.0) < epsilon)
    }
    "weight larger segments more heavily" in {
      val centerA = Array(0.0f, 0.0f, 0.0f)
      val centerB = Array(10.0f, 0.0f, 0.0f)
      // segment B has 3x the volume of segment A, so the combined center should sit 3/4 of the way from A to B
      val combined = SegmentStatisticsMath.weightedCenterOfMass(Seq(centerA, centerB), Seq(1L, 3L)).toOption.get
      assert(Math.abs(combined(0) - 7.5) < epsilon)
    }
    "match a directly computed mean over the union of the segments' points" in {
      val pointsA = Seq(Array(0.0, 0.0, 0.0), Array(2.0, 0.0, 0.0), Array(0.0, 4.0, 0.0), Array(2.0, 4.0, 0.0))
      val pointsB = Seq(Array(10.0, 10.0, 10.0), Array(12.0, 10.0, 10.0))
      val meanA = meanOf(pointsA)
      val meanB = meanOf(pointsB)
      val expected = meanOf(pointsA ++ pointsB)

      val combined = SegmentStatisticsMath
        .weightedCenterOfMass(
          Seq(toFloatArray(meanA), toFloatArray(meanB)),
          Seq(pointsA.length.toLong, pointsB.length.toLong)
        )
        .toOption
        .get
      for (dim <- 0 until 3) assert(Math.abs(combined(dim) - expected(dim)) < epsilon)
      succeed
    }
  }

  "combineCovarianceMatrices" should {
    "fail when the total volume of the segments is zero" in {
      val cov = Array(Array(1.0f, 0.0f, 0.0f), Array(0.0f, 2.0f, 0.0f), Array(0.0f, 0.0f, 3.0f))
      val combined = SegmentStatisticsMath.combineCovarianceMatrices(Seq(cov), Seq(Array(0.0f, 0.0f, 0.0f)), Seq(0L))
      assert(combined.isEmpty)
    }
    "return the segment's own covariance matrix for a single segment" in {
      val cov = Array(Array(1.0f, 0.0f, 0.0f), Array(0.0f, 2.0f, 0.0f), Array(0.0f, 0.0f, 3.0f))
      val center = Array(5.0f, 5.0f, 5.0f)
      val combined = SegmentStatisticsMath.combineCovarianceMatrices(Seq(cov), Seq(center), Seq(10L)).toOption.get
      for (i <- 0 until 3; j <- 0 until 3) assert(Math.abs(combined(i)(j) - cov(i)(j)) < epsilon)
      succeed
    }
    "match a directly computed covariance over the union of the segments' points (parallel axis theorem)" in {
      val pointsA = Seq(Array(0.0, 0.0, 0.0), Array(2.0, 0.0, 0.0), Array(0.0, 4.0, 0.0), Array(2.0, 4.0, 0.0))
      val pointsB = Seq(Array(10.0, 10.0, 10.0), Array(12.0, 10.0, 10.0))

      val meanA = meanOf(pointsA)
      val meanB = meanOf(pointsB)
      val covA = covarianceOf(pointsA, meanA)
      val covB = covarianceOf(pointsB, meanB)

      val allPoints = pointsA ++ pointsB
      val expectedMean = meanOf(allPoints)
      val expectedCov = covarianceOf(allPoints, expectedMean)

      val combined = SegmentStatisticsMath
        .combineCovarianceMatrices(
          Seq(toFloatMatrix(covA), toFloatMatrix(covB)),
          Seq(toFloatArray(meanA), toFloatArray(meanB)),
          Seq(pointsA.length.toLong, pointsB.length.toLong)
        )
        .toOption
        .get

      for (i <- 0 until 3; j <- 0 until 3)
        assert(Math.abs(combined(i)(j) - expectedCov(i)(j)) < epsilon, s"mismatch at entry ($i, $j)")
      succeed
    }
  }
}
