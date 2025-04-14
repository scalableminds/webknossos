package backend

import com.scalableminds.webknossos.datastore.helpers.NativeBucketScanner
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import org.scalatestplus.play.PlaySpec

class BucketScannerTestSuite extends PlaySpec {
  "NativeBucketScanner" should {
    "collect segment ids in a byte array with ElementClass uint16" in {
      val elementClass = ElementClass.uint16
      // little endian uint16 representation of 2, 4, 500, 500
      val array = Array[Byte](2, 0, 4, 0, 244.toByte, 1, 244.toByte, 1)
      val scanner = new NativeBucketScanner()
      val segmentIds = scanner.collectSegmentIds(array,
                                                 ElementClass.bytesPerElement(elementClass),
                                                 ElementClass.isSigned(elementClass),
                                                 skipZeroes = false)
      assert(segmentIds.sorted.sameElements(Array[Long](2, 4, 500)))
    }

    "collect segment ids in a byte array with ElementClass uint32" in {
      val elementClass = ElementClass.uint32
      // little endian uint16 representation of 2, 4, 500, 500
      val array = Array[Byte](2, 0, 0, 0, 4, 0, 0, 0, 244.toByte, 1, 0, 0, 244.toByte, 1, 0, 0)
      val scanner = new NativeBucketScanner()
      val segmentIds = scanner.collectSegmentIds(array,
                                                 ElementClass.bytesPerElement(elementClass),
                                                 ElementClass.isSigned(elementClass),
                                                 skipZeroes = false)
      assert(segmentIds.sorted.sameElements(Array[Long](2, 4, 500)))
    }

  }
}
