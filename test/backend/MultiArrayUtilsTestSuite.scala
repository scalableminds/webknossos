package backend

import com.scalableminds.webknossos.datastore.datareaders.MultiArrayUtils
import org.scalatest.Assertion
import org.scalatest.wordspec.AsyncWordSpec
import ucar.ma2.{Array as MultiArray, DataType as MADataType}

class MultiArrayUtilsTestSuite extends AsyncWordSpec {

  private val sentinel = -1

  private def sequentialSource(shape: Array[Int]): MultiArray = {
    val arr = MultiArray.factory(MADataType.INT, shape)
    val it = arr.getIndexIterator
    var v = 0
    while (it.hasNext) {
      it.setIntNext(v)
      v += 1
    }
    arr
  }

  private def sentinelArray(shape: Array[Int]): MultiArray = {
    val arr = MultiArray.factory(MADataType.INT, shape)
    val it = arr.getIndexIterator
    while (it.hasNext) it.setIntNext(sentinel)
    arr
  }

  private def toFlatInts(arr: MultiArray): Array[Int] = {
    val it = arr.getIndexIterator
    val buf = scala.collection.mutable.ArrayBuffer[Int]()
    while (it.hasNext) buf += it.getIntNext
    buf.toArray
  }

  private def check(
      offset: Array[Int],
      sourceShape: Array[Int],
      targetShape: Array[Int],
      expected: Array[Int],
      permuteSource: Boolean = false
  ): Assertion = {
    val plainSource = sequentialSource(sourceShape)
    val source =
      if (permuteSource) plainSource.copy.permute(Array.range(0, sourceShape.length).reverse) else plainSource
    val effectiveOffset = if (permuteSource) offset.reverse else offset
    val target = sentinelArray(targetShape)

    MultiArrayUtils.copyRange(effectiveOffset, source, target)

    assert(toFlatInts(target).sameElements(expected))
  }

  "MultiArrayUtils.copyRange" should {
    "copy an exact aligned 3D range" in
      check(Array(0, 0, 0), Array(2, 2, 2), Array(2, 2, 2), Array(0, 1, 2, 3, 4, 5, 6, 7))

    "copy with a positive offset in every dimension" in
      check(Array(1, 1, 1), Array(3, 3, 3), Array(2, 2, 2), Array(13, 14, 16, 17, 22, 23, 25, 26))

    "copy with a negative offset in every dimension" in
      check(
        Array(-1, -1, -1),
        Array(2, 2, 2),
        Array(3, 3, 3),
        Array(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0, 1, -1, 2, 3, -1, -1, -1, -1, 4, 5, -1, 6, 7)
      )

    "copy with mixed positive and negative offsets" in
      check(
        Array(1, -1, 0),
        Array(3, 2, 2),
        Array(2, 3, 2),
        Array(-1, -1, 4, 5, 6, 7, -1, -1, 8, 9, 10, 11)
      )

    "leave the target untouched when there is no overlap in some dimension" in {
      val source = sequentialSource(Array(8, 8, 8))
      val target = sentinelArray(Array(8, 8, 8))
      MultiArrayUtils.copyRange(Array(20, 0, 0), source, target)
      assert(toFlatInts(target).forall(_ == sentinel))
    }

    "copy correctly when the last dimension has size 1" in
      check(Array(1, 1, 0), Array(2, 2, 1), Array(2, 2, 1), Array(3, -1, -1, -1))

    "copy a 4D range (e.g. channel + xyz) exactly" in
      check(
        Array(0, 0, 0, 0),
        Array(2, 2, 2, 2),
        Array(2, 2, 2, 2),
        Array(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)
      )

    "copy a 4D range with an offset" in
      check(
        Array(0, 1, 1, 1),
        Array(2, 3, 3, 3),
        Array(2, 2, 2, 2),
        Array(13, 14, 16, 17, 22, 23, 25, 26, 40, 41, 43, 44, 49, 50, 52, 53)
      )

    "copy a 1D range exactly" in
      check(Array(0), Array(4), Array(4), Array(0, 1, 2, 3))

    "copy a 1D range with an offset" in
      check(Array(2), Array(6), Array(3), Array(2, 3, 4))

    "copy a 2D range with an offset" in
      check(Array(1, 2), Array(4, 5), Array(2, 2), Array(7, 8, 12, 13))

    "still be correct when the source is a permuted (non-contiguous) view, exact case" in
      check(Array(0, 0, 0), Array(2, 2, 2), Array(2, 2, 2), Array(0, 4, 2, 6, 1, 5, 3, 7), permuteSource = true)

    "still be correct when the source is a permuted (non-contiguous) view, offset case" in
      check(
        Array(1, 1, 1),
        Array(3, 3, 3),
        Array(2, 2, 2),
        Array(13, 22, 16, 25, 14, 23, 17, 26),
        permuteSource = true
      )

    "fall back to the iterator copy (instead of crashing) when source and target element types differ" in {
      val source = sequentialSource(Array(2, 2, 2))
      val target = MultiArray.factory(MADataType.LONG, Array(2, 2, 2))
      val targetIt = target.getIndexIterator
      while (targetIt.hasNext) targetIt.setLongNext(sentinel.toLong)

      MultiArrayUtils.copyRange(Array(0, 0, 0), source, target)

      val resultIt = target.getIndexIterator
      val result = scala.collection.mutable.ArrayBuffer[Long]()
      while (resultIt.hasNext) result += resultIt.getLongNext
      assert(result.toArray.sameElements(Array(0L, 1L, 2L, 3L, 4L, 5L, 6L, 7L)))
    }
  }
}
