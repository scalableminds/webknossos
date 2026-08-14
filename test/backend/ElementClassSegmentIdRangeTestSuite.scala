package backend

import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import org.scalatest.wordspec.AsyncWordSpec

class ElementClassSegmentIdRangeTestSuite extends AsyncWordSpec {

  "largestSegmentIdIsInRange for uint64" should {
    "accept ids within the legacy 2^53 range" in
      assert(ElementClass.largestSegmentIdIsInRange((1L << 53) - 1, ElementClass.uint64))
    "accept ids above 2^53 but below 2^63" in
      assert(ElementClass.largestSegmentIdIsInRange(Long.MaxValue, ElementClass.uint64))
    "accept ids at the 2^63 sign-bit boundary (Long.MinValue bit pattern)" in
      assert(ElementClass.largestSegmentIdIsInRange(Long.MinValue, ElementClass.uint64))
    "accept the maximum uint64 value (-1L bit pattern, i.e. 2^64 - 1)" in
      assert(ElementClass.largestSegmentIdIsInRange(-1L, ElementClass.uint64))
    "accept zero" in
      assert(ElementClass.largestSegmentIdIsInRange(0L, ElementClass.uint64))
  }

  "largestSegmentIdIsInRange for int64" should {
    "accept ids up to Long.MaxValue (2^63 - 1)" in
      assert(ElementClass.largestSegmentIdIsInRange(Long.MaxValue, ElementClass.int64))
    "reject negative ids" in {
      assert(!ElementClass.largestSegmentIdIsInRange(-1L, ElementClass.int64))
      assert(!ElementClass.largestSegmentIdIsInRange(Long.MinValue, ElementClass.int64))
    }
  }

  "largestSegmentIdIsInRange for smaller unsigned element classes" should {
    "still enforce their original bounds" in {
      assert(ElementClass.largestSegmentIdIsInRange((1L << 8) - 1, ElementClass.uint8))
      assert(!ElementClass.largestSegmentIdIsInRange(1L << 8, ElementClass.uint8))
      assert(ElementClass.largestSegmentIdIsInRange((1L << 16) - 1, ElementClass.uint16))
      assert(!ElementClass.largestSegmentIdIsInRange(1L << 16, ElementClass.uint16))
      assert(ElementClass.largestSegmentIdIsInRange((1L << 32) - 1, ElementClass.uint32))
      assert(!ElementClass.largestSegmentIdIsInRange(1L << 32, ElementClass.uint32))
    }
  }

  "largestSegmentIdIsInRange for non-segmentation element classes" should {
    "always reject, regardless of value" in {
      assert(!ElementClass.largestSegmentIdIsInRange(0L, ElementClass.float))
      assert(!ElementClass.largestSegmentIdIsInRange(0L, ElementClass.double))
    }
  }

  "largestSegmentIdIsInRange with no largestSegmentId set" should {
    "accept for any segmentation element class" in {
      assert(ElementClass.largestSegmentIdIsInRange(None, ElementClass.uint64))
      assert(ElementClass.largestSegmentIdIsInRange(None, ElementClass.uint8))
    }
    "reject for non-segmentation element classes" in
      assert(!ElementClass.largestSegmentIdIsInRange(None, ElementClass.float))
  }

}
