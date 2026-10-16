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

  // Binary voxel run encoding (encodeBucketDiff in the frontend): uint8 formatVersion 1, uint8 runAxis,
  // little-endian uint64 value, varint runCount, then runCount times (varint gap, varint length).
  private def voxelRunsBytes(value: Long, runs: Seq[(Int, Int)], runAxis: Int = 0): Array[Byte] = {
    val header = ByteBuffer.allocate(10).order(ByteOrder.LITTLE_ENDIAN)
    header.put(1.toByte)
    header.put(runAxis.toByte)
    header.putLong(value)
    var previousEnd = 0
    val body = varint(runs.length) ++ runs.flatMap { case (start, length) =>
      val encoded = varint(start - previousEnd) ++ varint(length)
      previousEnd = start + length
      encoded
    }
    header.array() ++ body
  }

  private def varint(value: Int): Array[Byte] =
    if (value < 0x80) Array(value.toByte)
    else Array(((value & 0x7f) | 0x80).toByte) ++ varint(value >>> 7)

  private val bucketVoxelCount = 32 * 32 * 32

  private def flatIndex(x: Int, y: Int, z: Int): Int = x + 32 * y + 32 * 32 * z

  // A uint16 bucket where element i holds i % 1000 + 1, so that untouched elements are recognizable.
  private def uint16Bucket(): Array[Byte] = {
    val buffer = ByteBuffer.allocate(bucketVoxelCount * 2).order(ByteOrder.LITTLE_ENDIAN)
    (0 until bucketVoxelCount).foreach(i => buffer.putShort((i % 1000 + 1).toShort))
    buffer.array()
  }

  private def readUint16s(bytes: Array[Byte]): IndexedSeq[Int] = {
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    IndexedSeq.fill(bytes.length / 2)(buffer.getShort & 0xffff)
  }

  private def applyToUint16Bucket(runs: Array[Byte]): IndexedSeq[Int] = {
    val elementClass = ElementClass.uint16
    readUint16s(
      new NativeBucketScanner().applyVoxelRuns(
        uint16Bucket(),
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        runs
      )
    )
  }

  // Indices that differ between the original bucket and the updated one.
  private def changedIndices(updated: IndexedSeq[Int]): Set[Int] = {
    val original = readUint16s(uint16Bucket())
    updated.indices.filter(i => updated(i) != original(i)).toSet
  }

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

    "find bounding box of segment correctly in a byte array with ElementClass uint64, with a topmost-bit-set segment id" in {
      val elementClass = ElementClass.uint64
      val bytesPerBucket =
        ElementClass.bytesPerElement(elementClass) * scala.math.pow(DataLayer.bucketLength, 3).intValue
      val array = Array.fill[Byte](bytesPerBucket)(0)
      val bytesPerElement = ElementClass.bytesPerElement(elementClass)
      val topBitSetBytes = littleEndianBytes(Seq(topBitSetHigh))
      Array.copy(topBitSetBytes, 0, array, bytesPerElement * (DataLayer.bucketLength + 5), bytesPerElement)
      Array.copy(topBitSetBytes, 0, array, bytesPerElement * (DataLayer.bucketLength + 8), bytesPerElement)
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

    "apply voxel runs in x order, also across rows" in {
      // (1, 2): two voxels in the first row. (30, 4): crosses from the end of row y=0 into row y=1.
      val updated = applyToUint16Bucket(voxelRunsBytes(value = 999, runs = Seq((1, 2), (30, 4))))
      assert(changedIndices(updated) == Set(1, 2, 30, 31, 32, 33))
      assert(Seq(1, 2, 30, 31, 32, 33).forall(updated(_) == 999))
    }

    "apply voxel runs in y order (y, z, x), as sent for YZ strokes" in {
      // Linear index y + 32·z + 1024·x. A run of 34 from 0 covers y = 0..31 at z = 0 and y = 0..1 at z = 1,
      // all at x = 0. The run at 1024 + 5 is at x = 1, y = 5, z = 0.
      val updated = applyToUint16Bucket(voxelRunsBytes(value = 999, runs = Seq((0, 34), (1024 + 5, 1)), runAxis = 1))
      val expected = (0 until 32).map(y => flatIndex(0, y, 0)).toSet ++
        Set(flatIndex(0, 0, 1), flatIndex(0, 1, 1), flatIndex(1, 5, 0))
      assert(changedIndices(updated) == expected)
      assert(expected.forall(updated(_) == 999))
    }

    "apply voxel runs in z order (z, x, y), as sent for XZ strokes" in {
      // Linear index z + 32·x + 1024·y: z = 3..4 at x = 2, y = 7.
      val start = 3 + 32 * 2 + 1024 * 7
      val updated = applyToUint16Bucket(voxelRunsBytes(value = 999, runs = Seq((start, 2)), runAxis = 2))
      assert(changedIndices(updated) == Set(flatIndex(2, 7, 3), flatIndex(2, 7, 4)))
    }

    "apply a run that covers the whole bucket, with multi-byte varints" in {
      val updated = applyToUint16Bucket(voxelRunsBytes(value = 999, runs = Seq((0, bucketVoxelCount))))
      assert(updated.forall(_ == 999))
    }

    "apply voxel runs in a uint64 bucket, with a topmost-bit-set segment id" in {
      val elementClass = ElementClass.uint64
      val array = littleEndianBytes(Seq.fill(bucketVoxelCount)(7L))
      val updated = new NativeBucketScanner().applyVoxelRuns(
        array,
        ElementClass.bytesPerElement(elementClass),
        ElementClass.isSigned(elementClass),
        voxelRunsBytes(value = topBitSetHigh, runs = Seq((0, 1), (2, 1)))
      )
      assert(readLongsLittleEndian(updated).take(4) == Seq(topBitSetHigh, 7L, topBitSetHigh, 7L))
    }

    "fail to apply malformed voxel runs" in {
      val valid = voxelRunsBytes(value = 999, runs = Seq((1, 2)))
      val malformed = Seq(
        "exceeding the bucket" -> voxelRunsBytes(value = 999, runs = Seq((bucketVoxelCount - 1, 2))),
        "unknown format version" -> (Array(2.toByte) ++ valid.drop(1)),
        "unknown run axis" -> (valid.take(1) ++ Array(3.toByte) ++ valid.drop(2)),
        "truncated" -> valid.dropRight(1),
        "trailing bytes" -> (valid ++ Array(0.toByte)),
        "header only" -> valid.take(10)
      )
      malformed.foreach { case (description, runs) =>
        withClue(description) {
          assertThrows[RuntimeException](applyToUint16Bucket(runs))
        }
      }
      succeed
    }

    "fail to apply voxel runs to a bucket that is not 32^3" in {
      val elementClass = ElementClass.uint16
      assertThrows[RuntimeException] {
        new NativeBucketScanner().applyVoxelRuns(
          Array[Byte](1, 0, 2, 0, 3, 0, 4, 0),
          ElementClass.bytesPerElement(elementClass),
          ElementClass.isSigned(elementClass),
          voxelRunsBytes(value = 99, runs = Seq((1, 2)))
        )
      }
    }

  }
}
