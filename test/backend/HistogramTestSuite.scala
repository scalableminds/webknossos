package backend

import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.services.{BinaryDataServiceHolder, FindDataService}
import org.scalatest.Assertion
import org.scalatest.wordspec.AsyncWordSpec

import scala.concurrent.ExecutionContext

class HistogramTestSuite extends AsyncWordSpec {

  // calculateHistogramValues does not access binaryDataService, so a null holder is safe.
  implicit private val ec: ExecutionContext = ExecutionContext.global
  private val service = new FindDataService(null.asInstanceOf[BinaryDataServiceHolder])

  // Helper to widen typed arrays to the existential type expected by calculateHistogramValues.
  private def bytes(values: Byte*): Array[_ >: Byte with Short with Int with Long with Float] = values.toArray
  private def shorts(values: Short*): Array[_ >: Byte with Short with Int with Long with Float] = values.toArray
  private def ints(values: Int*): Array[_ >: Byte with Short with Int with Long with Float] = values.toArray
  private def longs(values: Long*): Array[_ >: Byte with Short with Int with Long with Float] = values.toArray
  private def floats(values: Float*): Array[_ >: Byte with Short with Int with Long with Float] = values.toArray

  private def assertSingleHistogram(
      elementClass: ElementClass.Value,
      data: Array[_ >: Byte with Short with Int with Long with Float],
      expectedMin: Double,
      expectedMax: Double,
      expectedBinCounts: Map[Int, Long]
  ): Assertion = {
    val histograms = service.calculateHistogramValues(data, elementClass)
    assert(histograms.length == 1)
    val h = histograms.head
    assert(h.min == expectedMin)
    assert(h.max == expectedMax)
    expectedBinCounts.foreach { case (bin, count) =>
      assert(h.elementCounts(bin) == count, s"bin $bin: expected $count, got ${h.elementCounts(bin)}")
    }
    succeed
  }

  "FindDataService.calculateHistogramValues" when {

    "elementClass is uint8" should {
      // Values 1, 10, 255 (as unsigned) → bins 1, 10, 255
      "place unsigned byte values into correct bins" in
        assertSingleHistogram(
          ElementClass.uint8,
          bytes(1, 10, (-1).toByte), // (-1).toByte == 255 as unsigned
          expectedMin = 0.0,
          expectedMax = 255.0,
          expectedBinCounts = Map(1 -> 1L, 10 -> 1L, 255 -> 1L)
        )
      "count multiple values in the same bin" in
        assertSingleHistogram(
          ElementClass.uint8,
          bytes(5, 5, 5),
          expectedMin = 0.0,
          expectedMax = 255.0,
          expectedBinCounts = Map(5 -> 3L)
        )
    }

    "elementClass is int8" should {
      // Signed bytes: bin = value + 128
      // -128 → 0, 0 → 128, 127 → 255
      "map signed byte values to correct bins" in
        assertSingleHistogram(
          ElementClass.int8,
          bytes((-128).toByte, 0, 127),
          expectedMin = -128.0,
          expectedMax = 127.0,
          expectedBinCounts = Map(0 -> 1L, 128 -> 1L, 255 -> 1L)
        )
      "place negative bytes below the midpoint bin" in
        assertSingleHistogram(
          ElementClass.int8,
          bytes((-1).toByte, (-64).toByte),
          expectedMin = -128.0,
          expectedMax = 127.0,
          // -1 + 128 = 127, -64 + 128 = 64
          expectedBinCounts = Map(127 -> 1L, 64 -> 1L)
        )
    }

    "elementClass is uint16" should {
      // Unsigned: bin = (value & 0xFFFF) >> 8; values 0, 256, 65535 → bins 0, 1, 255
      "place unsigned short values into correct bins" in
        assertSingleHistogram(
          ElementClass.uint16,
          shorts(0, 256, (-1).toShort), // (-1).toShort == 65535 as unsigned
          expectedMin = 0.0,
          expectedMax = 65535.0,
          expectedBinCounts = Map(0 -> 1L, 1 -> 1L, 255 -> 1L)
        )
    }

    "elementClass is int16" should {
      // Signed: bin = (value >> 8) + 128
      // Short.MinValue (-32768) → -128 + 128 = 0
      // 0 → 0 + 128 = 128
      // Short.MaxValue (32767) → 127 + 128 = 255
      "map signed short values to correct bins" in
        assertSingleHistogram(
          ElementClass.int16,
          shorts(Short.MinValue, 0, Short.MaxValue),
          expectedMin = -32768.0,
          expectedMax = 32767.0,
          expectedBinCounts = Map(0 -> 1L, 128 -> 1L, 255 -> 1L)
        )
      "place negative shorts below the midpoint bin" in
        assertSingleHistogram(
          ElementClass.int16,
          shorts((-256).toShort),
          expectedMin = -32768.0,
          expectedMax = 32767.0,
          // (-256 >> 8) + 128 = -1 + 128 = 127
          expectedBinCounts = Map(127 -> 1L)
        )
    }

    "elementClass is uint32" should {
      // Unsigned: bin = value >>> 24
      // 0 → 0, 1<<24 → 1, -1 (0xFFFFFFFF) → 255
      "place unsigned int values into correct bins" in
        assertSingleHistogram(
          ElementClass.uint32,
          ints(0, 1 << 24, -1),
          expectedMin = 0.0,
          expectedMax = math.pow(2, 32) - 1,
          expectedBinCounts = Map(0 -> 1L, 1 -> 1L, 255 -> 1L)
        )
    }

    "elementClass is int32" should {
      // Signed: bin = (value >> 24) + 128
      // Int.MinValue → -128 + 128 = 0
      // 0 → 0 + 128 = 128
      // Int.MaxValue → 127 + 128 = 255
      "map signed int values to correct bins" in
        assertSingleHistogram(
          ElementClass.int32,
          ints(Int.MinValue, 0, Int.MaxValue),
          expectedMin = -2147483648.0,
          expectedMax = 2147483647.0,
          expectedBinCounts = Map(0 -> 1L, 128 -> 1L, 255 -> 1L)
        )
      "place negative ints below the midpoint bin" in
        assertSingleHistogram(
          ElementClass.int32,
          ints(-1),
          expectedMin = -2147483648.0,
          expectedMax = 2147483647.0,
          // (-1 >> 24) + 128 = -1 + 128 = 127
          expectedBinCounts = Map(127 -> 1L)
        )
    }

    "elementClass is uint64" should {
      // Unsigned: bin = (value >>> 56).toInt
      // 0L → 0, 1L<<56 → 1, -1L (0xFFF...F) → 255
      "place unsigned long values into correct bins" in
        assertSingleHistogram(
          ElementClass.uint64,
          longs(0L, 1L << 56, -1L),
          expectedMin = 0.0,
          expectedMax = math.pow(2, 64) - 1,
          expectedBinCounts = Map(0 -> 1L, 1 -> 1L, 255 -> 1L)
        )
    }

    "elementClass is int64" should {
      // Signed: bin = (value >> 56).toInt + 128
      // Long.MinValue → -128 + 128 = 0
      // 0L → 0 + 128 = 128
      // Long.MaxValue → 127 + 128 = 255
      "map signed long values to correct bins" in
        assertSingleHistogram(
          ElementClass.int64,
          longs(Long.MinValue, 0L, Long.MaxValue),
          expectedMin = -math.pow(2, 63),
          expectedMax = math.pow(2, 63) - 1,
          expectedBinCounts = Map(0 -> 1L, 128 -> 1L, 255 -> 1L)
        )
      "place negative longs below the midpoint bin" in
        assertSingleHistogram(
          ElementClass.int64,
          longs(-1L),
          expectedMin = -math.pow(2, 63),
          expectedMax = math.pow(2, 63) - 1,
          // (-1L >> 56).toInt + 128 = -1 + 128 = 127
          expectedBinCounts = Map(127 -> 1L)
        )
    }

    "elementClass is float" should {
      // Dynamic range: bin = floor((value - min) / binSize), binSize = (max - min) / 255
      // For [0f, 1f, 2f]: min=0, max=2, binSize=2/255
      // 0f → 0, 1f → floor(127.5) = 127, 2f → 254 (float precision)
      "distribute float values across 256 bins based on their range" in {
        val data = floats(0f, 1f, 2f)
        val histograms = service.calculateHistogramValues(data, ElementClass.float)
        assert(histograms.length == 1)
        val h = histograms.head
        assert(h.min == 0.0)
        assert(h.max == 2.0)
        // binSize = 2/255; 0f → bin 0, 1f → floor(1/(2/255)) = floor(127.5) = 127
        // 2f → floor(2/(2/255)) falls to 254 due to float precision (not 255)
        assert(h.elementCounts(0) == 1L)
        assert(h.elementCounts(127) == 1L)
        assert(h.elementCounts(254) == 1L)
      }
      "put all values into bin 0 when all are identical (binSize degenerates to 1)" in {
        val data = floats(3.14f, 3.14f, 3.14f)
        val histograms = service.calculateHistogramValues(data, ElementClass.float)
        assert(histograms.length == 1)
        val h = histograms.head
        assert(h.min == 3.14f.toDouble)
        assert(h.max == 3.14f.toDouble)
        assert(h.elementCounts(0) == 3L)
      }
      "handle negative float values" in {
        val data = floats(-2f, 0f, 2f)
        val histograms = service.calculateHistogramValues(data, ElementClass.float)
        assert(histograms.length == 1)
        val h = histograms.head
        assert(h.min == -2.0)
        assert(h.max == 2.0)
        // binSize = 4/255; -2f → bin 0, 0f → floor(2/(4/255)) = floor(127.5) = 127
        // 2f → 254 due to float precision
        assert(h.elementCounts(0) == 1L)
        assert(h.elementCounts(127) == 1L)
        assert(h.elementCounts(254) == 1L)
      }
    }

    "elementClass is uint24" should {
      // Three interleaved byte channels (RGB). Returns 3 histograms, one per channel.
      // Bin 0 of each channel is zeroed out after accumulation.
      "return three histograms for RGB data" in {
        // One pixel: R=10, G=20, B=30  (none in bin 0, so no zeroing effect)
        val data: Array[_ >: Byte with Short with Int with Long with Float] =
          Array[Byte](10, 20, 30)
        val histograms = service.calculateHistogramValues(data, ElementClass.uint24)
        assert(histograms.length == 3)
        assert(histograms(0).elementCounts(10) == 1L)
        assert(histograms(1).elementCounts(20) == 1L)
        assert(histograms(2).elementCounts(30) == 1L)
        assert(histograms(0).min == 0.0)
        assert(histograms(0).max == 255.0)
      }
      "zero out bin 0 in each channel histogram" in {
        // Pixel with R=0, G=5, B=10 — the R channel hits bin 0, which gets cleared
        val data: Array[_ >: Byte with Short with Int with Long with Float] =
          Array[Byte](0, 5, 10)
        val histograms = service.calculateHistogramValues(data, ElementClass.uint24)
        assert(histograms.length == 3)
        assert(histograms(0).elementCounts(0) == 0L) // bin 0 was zeroed
        assert(histograms(1).elementCounts(5) == 1L)
        assert(histograms(2).elementCounts(10) == 1L)
      }
      "handle multiple pixels correctly" in {
        // Two pixels: (1, 2, 3) and (1, 4, 6)
        val data: Array[_ >: Byte with Short with Int with Long with Float] =
          Array[Byte](1, 2, 3, 1, 4, 6)
        val histograms = service.calculateHistogramValues(data, ElementClass.uint24)
        assert(histograms.length == 3)
        assert(histograms(0).elementCounts(1) == 2L) // R=1 appears twice
        assert(histograms(1).elementCounts(2) == 1L) // G=2
        assert(histograms(1).elementCounts(4) == 1L) // G=4
        assert(histograms(2).elementCounts(3) == 1L) // B=3
        assert(histograms(2).elementCounts(6) == 1L) // B=6
      }
    }

    "data is empty" should {
      "return a histogram with all zero counts for uint8" in {
        val data: Array[_ >: Byte with Short with Int with Long with Float] = Array.empty[Byte]
        val histograms = service.calculateHistogramValues(data, ElementClass.uint8)
        assert(histograms.length == 1)
        val h = histograms.head
        assert(h.elementCounts.forall(_ == 0L))
      }
    }
  }
}
