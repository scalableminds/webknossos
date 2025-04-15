package backend

import com.scalableminds.webknossos.datastore.helpers.NativeBucketScanner
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
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

    "skip zeroes in collectSegmentIds if requested" in {
      val elementClass = ElementClass.uint16
      // little endian uint16 representation of 2, 4, 500, 500
      val array = Array[Byte](2, 0, 4, 0, 244.toByte, 1, 244.toByte, 1, 0, 0)
      val scanner = new NativeBucketScanner()
      val segmentIds = scanner.collectSegmentIds(array,
                                                 ElementClass.bytesPerElement(elementClass),
                                                 ElementClass.isSigned(elementClass),
                                                 skipZeroes = false)
      assert(segmentIds.sorted.sameElements(Array[Long](0, 2, 4, 500)))

      val segmentIds2 = scanner.collectSegmentIds(array,
                                                  ElementClass.bytesPerElement(elementClass),
                                                  ElementClass.isSigned(elementClass),
                                                  skipZeroes = true)
      assert(segmentIds2.sorted.sameElements(Array[Long](2, 4, 500)))
    }

    "count segment voxels correctly in a byte array with ElementClass uint32" in {
      val elementClass = ElementClass.uint32
      // little endian uint16 representation of 2, 4, 500, 500
      val array = Array[Byte](2, 0, 0, 0, 4, 0, 0, 0, 244.toByte, 1, 0, 0, 244.toByte, 1, 0, 0)
      val scanner = new NativeBucketScanner()
      val voxelCount = scanner.countSegmentVoxels(array,
                                                  ElementClass.bytesPerElement(elementClass),
                                                  ElementClass.isSigned(elementClass),
                                                  segmentId = 500)
      assert(voxelCount == 2)
      val voxelCount2 = scanner.countSegmentVoxels(array,
                                                   ElementClass.bytesPerElement(elementClass),
                                                   ElementClass.isSigned(elementClass),
                                                   segmentId = 501)
      assert(voxelCount2 == 0)
    }

    "find bounding box of segment correctly in a byte array with ElementClass uint16" in {
      val elementClass = ElementClass.uint16
      val bytesPerBucket = ElementClass.bytesPerElement(elementClass) * scala.math
        .pow(DataLayer.bucketLength, 3)
        .intValue
      val array = Array.fill[Byte](bytesPerBucket)(0)
      array(ElementClass.bytesPerElement(elementClass) * (DataLayer.bucketLength + 5)) = 1
      array(ElementClass.bytesPerElement(elementClass) * (DataLayer.bucketLength + 8)) = 1
      val scanner = new NativeBucketScanner()
      val boundingBox = scanner.extendSegmentBoundingBox(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        DataLayer.bucketLength,
        1,
        0,
        0,
        0,
        Int.MaxValue,
        Int.MaxValue,
        Int.MaxValue,
        Int.MinValue,
        Int.MinValue,
        Int.MinValue
      )
      assert(boundingBox.sameElements(Array[Long](5, 1, 0, 8, 1, 0)))
    }

  }
}
