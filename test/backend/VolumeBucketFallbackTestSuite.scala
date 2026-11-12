package backend

import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingBucketHelper
import org.scalatest.wordspec.AsyncWordSpec

class VolumeBucketFallbackTestSuite extends AsyncWordSpec {

  private val revertedMarker: Array[Byte] = VolumeTracingBucketHelper.revertedValue
  private val annotatedBytes: Array[Byte] = Array.fill[Byte](8)(1)
  private val fallbackBytes: Array[Byte] = Array.fill[Byte](8)(2)

  private def bytesOf(boxes: Seq[Box[Array[Byte]]]): Seq[Option[Seq[Byte]]] =
    boxes.map(_.toOption.map(_.toSeq))

  // Mirrors loadBuckets: drop reverted markers, then fill every Empty box with fallback data.
  private def withFallback(
      fromFossil: Seq[Box[Array[Byte]]],
      fallbackFor: Int => Box[Array[Byte]]
  ): Seq[Box[Array[Byte]]] = {
    val withoutReverted = VolumeTracingBucketHelper.revertedAsEmpty(fromFossil)
    val fallbackRequestCount = withoutReverted.count(_.isEmpty)
    VolumeTracingBucketHelper.fillEmptyWithFallback(withoutReverted, (0 until fallbackRequestCount).map(fallbackFor))
  }

  "revertedAsEmpty" should {
    "map reverted markers to Empty and keep everything else" in {
      val failure = Failure("fossil failed")
      val result = VolumeTracingBucketHelper.revertedAsEmpty(
        Seq(Full(annotatedBytes), Full(revertedMarker), Empty, failure)
      )
      assert(bytesOf(result.take(3)) == Seq(Some(annotatedBytes.toSeq), None, None))
      assert(result(1) == Empty)
      assert(result(3) == failure)
    }

    "not treat a one-byte bucket with another value as reverted" in {
      val result = VolumeTracingBucketHelper.revertedAsEmpty(Seq(Full(Array[Byte](1))))
      assert(bytesOf(result) == Seq(Some(Seq[Byte](1))))
    }
  }

  "Loading buckets with a fallback layer" should {
    "fill reverted buckets with fallback data, like missing buckets" in {
      // A bucket reverted to a version before it was annotated must show the fallback data again,
      // otherwise partial updates on it are folded onto zeros and the fallback segments are lost.
      val result = withFallback(
        Seq(Full(annotatedBytes), Full(revertedMarker), Empty),
        _ => Full(fallbackBytes)
      )
      assert(
        bytesOf(result) == Seq(Some(annotatedBytes.toSeq), Some(fallbackBytes.toSeq), Some(fallbackBytes.toSeq))
      )
    }

    "keep buckets Empty where the fallback layer has no data" in {
      val result = withFallback(
        Seq(Full(revertedMarker), Empty),
        idx => if (idx == 0) Empty else Full(fallbackBytes)
      )
      assert(bytesOf(result) == Seq(None, Some(fallbackBytes.toSeq)))
    }

    "assign fallback results in order" in {
      val fallbackA = Array.fill[Byte](8)(3)
      val fallbackB = Array.fill[Byte](8)(4)
      val result = withFallback(
        Seq(Empty, Full(annotatedBytes), Full(revertedMarker)),
        idx => Full(if (idx == 0) fallbackA else fallbackB)
      )
      assert(bytesOf(result) == Seq(Some(fallbackA.toSeq), Some(annotatedBytes.toSeq), Some(fallbackB.toSeq)))
    }
  }
}
