package backend

import com.scalableminds.webknossos.datastore.helpers.NativeBucketScanner
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import org.scalatest.wordspec.AsyncWordSpec

import java.nio.{ByteBuffer, ByteOrder}

class BucketScannerTestSuite extends AsyncWordSpec {

  // uint64 segment ids whose topmost bit is set, i.e. values that would be negative if
  // (mis)interpreted as a signed Long: 2^63 and 2^64 - 1.
  private val topBitSetLow: Long = Long.MinValue // bit pattern of 2^63
  private val topBitSetHigh: Long = -1L // bit pattern of 2^64 - 1

  private def littleEndianBytes(values: Seq[Long]): Array[Byte] = {
    val buffer = ByteBuffer.allocate(values.length * 8).order(ByteOrder.LITTLE_ENDIAN)
    values.foreach(buffer.putLong)
    buffer.array()
  }

  private def readLongsLittleEndian(bytes: Array[Byte]): Seq[Long] = {
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    Seq.fill(bytes.length / 8)(buffer.getLong)
  }

  // A bucket is stored in fortran order, x fastest.
  private def voxelIndex(x: Int, y: Int, z: Int): Int =
    x + y * DataLayer.bucketLength + z * DataLayer.bucketLength * DataLayer.bucketLength

  "NativeBucketScanner" should {
    "collect segment ids in a byte array with ElementClass uint16" in {
      val elementClass = ElementClass.uint16
      // little endian uint16 representation of 2, 4, 500, 500
      val array = Array[Byte](2, 0, 4, 0, 244.toByte, 1, 244.toByte, 1)
      val scanner = new NativeBucketScanner()
      val segmentIds = scanner.collectSegmentIds(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        skipZeroes = false
      )
      assert(segmentIds.sorted.sameElements(Array[Long](2, 4, 500)))
    }

    "collect segment ids in a byte array with ElementClass uint32" in {
      val elementClass = ElementClass.uint32
      // little endian uint32 representation of 2, 4, 500, 500
      val array = Array[Byte](2, 0, 0, 0, 4, 0, 0, 0, 244.toByte, 1, 0, 0, 244.toByte, 1, 0, 0)
      val scanner = new NativeBucketScanner()
      val segmentIds = scanner.collectSegmentIds(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        skipZeroes = false
      )
      assert(segmentIds.sorted.sameElements(Array[Long](2, 4, 500)))
    }

    "skip zeroes in collectSegmentIds if requested" in {
      val elementClass = ElementClass.uint16
      // little endian uint16 representation of 2, 4, 500, 500, 0
      val array = Array[Byte](2, 0, 4, 0, 244.toByte, 1, 244.toByte, 1, 0, 0)
      val scanner = new NativeBucketScanner()
      val segmentIds = scanner.collectSegmentIds(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        skipZeroes = false
      )
      assert(segmentIds.sorted.sameElements(Array[Long](0, 2, 4, 500)))

      val segmentIds2 = scanner.collectSegmentIds(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        skipZeroes = true
      )
      assert(segmentIds2.sorted.sameElements(Array[Long](2, 4, 500)))
    }

    "count segment voxels correctly in a byte array with ElementClass uint32" in {
      val elementClass = ElementClass.uint32
      // little endian uint32 representation of 2, 4, 500, 500
      val array = Array[Byte](2, 0, 0, 0, 4, 0, 0, 0, 244.toByte, 1, 0, 0, 244.toByte, 1, 0, 0)
      val scanner = new NativeBucketScanner()
      val voxelCount = scanner.countSegmentVoxels(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        segmentId = 500
      )
      assert(voxelCount == 2)
      val voxelCount2 = scanner.countSegmentVoxels(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        segmentId = 501
      )
      assert(voxelCount2 == 0)
    }

    "collect segment ids in a byte array with ElementClass uint64, including topmost-bit-set values" in {
      val elementClass = ElementClass.uint64
      val array = littleEndianBytes(Seq(2L, 4L, topBitSetHigh, topBitSetLow, topBitSetHigh))
      val scanner = new NativeBucketScanner()
      val segmentIds = scanner.collectSegmentIds(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        skipZeroes = false
      )
      // sort with unsigned semantics, since a plain (signed) sort would misorder topBitSetLow/topBitSetHigh
      val sorted = segmentIds.sortWith((a, b) => java.lang.Long.compareUnsigned(a, b) < 0)
      assert(sorted.sameElements(Array[Long](2L, 4L, topBitSetLow, topBitSetHigh)))
    }

    "count segment voxels correctly in a byte array with ElementClass uint64, including topmost-bit-set values" in {
      val elementClass = ElementClass.uint64
      val array = littleEndianBytes(Seq(2L, topBitSetHigh, topBitSetLow, topBitSetHigh))
      val scanner = new NativeBucketScanner()
      val highCount = scanner.countSegmentVoxels(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        segmentId = topBitSetHigh
      )
      assert(highCount == 2)
      val lowCount = scanner.countSegmentVoxels(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        segmentId = topBitSetLow
      )
      assert(lowCount == 1)
      val zeroCount = scanner.countSegmentVoxels(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        segmentId = 5
      )
      assert(zeroCount == 0)
    }

    "apply segment id mapping correctly in a byte array with ElementClass uint64, including topmost-bit-set values" in {
      val elementClass = ElementClass.uint64
      val array = littleEndianBytes(Seq(2L, topBitSetHigh, topBitSetLow, topBitSetHigh))
      val scanner = new NativeBucketScanner()
      // every distinct id present must be listed explicitly, unmapped ids default to 0
      val mapped = scanner.applySegmentIdMapping(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        idMappingSrc = Array[Long](2L, topBitSetHigh, topBitSetLow),
        idMappingDst = Array[Long](2L, topBitSetLow + 1, topBitSetLow) // map 2^64-1 -> 2^63+1, keep others as-is
      )
      assert(readLongsLittleEndian(mapped) == Seq(2L, topBitSetLow + 1, topBitSetLow, topBitSetLow + 1))
    }

    "find the position of a segment in a bucket with ElementClass uint32" in {
      val elementClass = ElementClass.uint32
      val bytesPerElement = ElementClass.bytesPerElement(elementClass)
      val array = Array.fill[Byte](bytesPerElement * scala.math.pow(DataLayer.bucketLength, 3).intValue)(0)
      // little endian uint32 value 500 at (5, 1, 0) and at (8, 1, 0)
      Seq(voxelIndex(5, 1, 0), voxelIndex(8, 1, 0)).foreach { index =>
        array(bytesPerElement * index) = 244.toByte
        array(bytesPerElement * index + 1) = 1
      }
      val scanner = new NativeBucketScanner()
      val position = scanner.findSegmentIdPosition(
        array,
        bytesPerElement,
        ElementClass.isSigned(elementClass),
        DataLayer.bucketLength,
        segmentId = 500
      )
      // the first one in the bucket's fortran order
      assert(position.sameElements(Array(5, 1, 0)))
    }

    "find the position of a segment in a bucket with ElementClass uint64, with a topmost-bit-set segment id" in {
      val elementClass = ElementClass.uint64
      val bytesPerElement = ElementClass.bytesPerElement(elementClass)
      val array = Array.fill[Byte](bytesPerElement * scala.math.pow(DataLayer.bucketLength, 3).intValue)(0)
      val topBitSetBytes = littleEndianBytes(Seq(topBitSetHigh))
      Array.copy(topBitSetBytes, 0, array, bytesPerElement * voxelIndex(5, 1, 0), bytesPerElement)
      Array.copy(topBitSetBytes, 0, array, bytesPerElement * voxelIndex(8, 1, 0), bytesPerElement)
      val scanner = new NativeBucketScanner()
      val position = scanner.findSegmentIdPosition(
        array,
        bytesPerElement,
        ElementClass.isSigned(elementClass),
        DataLayer.bucketLength,
        topBitSetHigh
      )
      assert(position.sameElements(Array(5, 1, 0)))
    }

    "return no position if the bucket does not contain the segment" in {
      val elementClass = ElementClass.uint32
      val bytesPerElement = ElementClass.bytesPerElement(elementClass)
      val array = Array.fill[Byte](bytesPerElement * scala.math.pow(DataLayer.bucketLength, 3).intValue)(0)
      array(bytesPerElement * voxelIndex(5, 1, 0)) = 7
      val scanner = new NativeBucketScanner()
      val position = scanner.findSegmentIdPosition(
        array,
        bytesPerElement,
        ElementClass.isSigned(elementClass),
        DataLayer.bucketLength,
        segmentId = 8
      )
      assert(position.isEmpty)
    }

    "return a position the segment really occupies, which a bounding box corner need not be" in {
      val elementClass = ElementClass.uint32
      val bytesPerElement = ElementClass.bytesPerElement(elementClass)
      val array = Array.fill[Byte](bytesPerElement * scala.math.pow(DataLayer.bucketLength, 3).intValue)(0)
      // Two voxels of segment 1, at (8, 1, 0) and (5, 3, 0). Their bounding box starts at (5, 1, 0),
      // which belongs to neither -- callers re-read the segment id at the position they are handed,
      // so the scan must return an occupied voxel rather than such a corner.
      Seq(voxelIndex(8, 1, 0), voxelIndex(5, 3, 0)).foreach { index =>
        array(bytesPerElement * index) = 1
      }
      val scanner = new NativeBucketScanner()
      val position = scanner.findSegmentIdPosition(
        array,
        bytesPerElement,
        ElementClass.isSigned(elementClass),
        DataLayer.bucketLength,
        segmentId = 1
      )
      assert(position.sameElements(Array(8, 1, 0)))

      val boundingBox = scanner.extendSegmentBoundingBox(
        array,
        bytesPerElement,
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
      assert(boundingBox.sameElements(Array(5, 1, 0, 8, 3, 0)))
      assert(!boundingBox.take(3).sameElements(position))
    }

    "find bounding box of segment correctly in a byte array with ElementClass uint64, with a topmost-bit-set segment id" in {
      val elementClass = ElementClass.uint64
      val bytesPerBucket =
        ElementClass.bytesPerElement(elementClass) * scala.math.pow(DataLayer.bucketLength, 3).intValue
      val array = Array.fill[Byte](bytesPerBucket)(0)
      val bytesPerElement = ElementClass.bytesPerElement(elementClass)
      val topBitSetBytes = littleEndianBytes(Seq(topBitSetHigh))
      Array.copy(topBitSetBytes, 0, array, bytesPerElement * voxelIndex(5, 1, 0), bytesPerElement)
      Array.copy(topBitSetBytes, 0, array, bytesPerElement * voxelIndex(8, 1, 0), bytesPerElement)
      val scanner = new NativeBucketScanner()
      val boundingBox = scanner.extendSegmentBoundingBox(
        array,
        bytesPerElement,
        ElementClass.isSigned(elementClass),
        DataLayer.bucketLength,
        topBitSetHigh,
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

    "find bounding box of segment correctly in a byte array with ElementClass uint16" in {
      val elementClass = ElementClass.uint16
      val bytesPerBucket =
        ElementClass.bytesPerElement(elementClass) * scala.math.pow(DataLayer.bucketLength, 3).intValue
      val array = Array.fill[Byte](bytesPerBucket)(0)
      array(ElementClass.bytesPerElement(elementClass) * voxelIndex(5, 1, 0)) = 1
      array(ElementClass.bytesPerElement(elementClass) * voxelIndex(8, 1, 0)) = 1
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
