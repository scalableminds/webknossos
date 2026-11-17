package backend

import com.scalableminds.webknossos.datastore.helpers.NativeBucketScanner
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.services.mapping.{JsonMapping, MappingService}
import org.scalatestplus.play.PlaySpec

import java.nio.{ByteBuffer, ByteOrder}
import scala.util.Random

class JsonMappingTestSuite extends PlaySpec {

  private val bucketScanner = new NativeBucketScanner()

  // Ids include values that exceed narrow element widths (300 == 44 as uint8), negative values (-1 == 255 as uint8),
  // a mapping of 0 and duplicate keys after truncation (300 and 44), where the later class wins.
  private val mappingJson =
    """{"name": "test", "classes": [[1, 2, 3, 4], [10, 0, 11], [7, 300, -1, 70000], [5, 44], [-2, 6, 4294967296]]}"""

  private val segmentIdPool: Seq[Long] =
    Seq(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 44, 255, 300, 70000, 4464, -1, -2, 4294967296L, Long.MinValue)

  private def encode(ids: Seq[Long], elementClass: ElementClass.Value): Array[Byte] = {
    val bytesPerElement = ElementClass.bytesPerElement(elementClass)
    val buffer = ByteBuffer.allocate(ids.length * bytesPerElement).order(ByteOrder.LITTLE_ENDIAN)
    ids.foreach { id =>
      buffer.put(ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(id).array(), 0, bytesPerElement)
    }
    buffer.array()
  }

  private def decode(data: Array[Byte], elementClass: ElementClass.Value): Seq[Long] = {
    val bytesPerElement = ElementClass.bytesPerElement(elementClass)
    data.grouped(bytesPerElement).toSeq.map { bytes =>
      val raw = bytes.zipWithIndex.foldLeft(0L) { case (acc, (b, i)) => acc | ((b & 0xffL) << (8 * i)) }
      MappingService.normalizeSegmentId(raw, elementClass)
    }
  }

  private def randomIds(voxelCount: Int, random: Random): Seq[Long] =
    Seq.fill(voxelCount)(
      if (random.nextInt(4) == 0) random.nextLong() else segmentIdPool(random.nextInt(segmentIdPool.length))
    )

  private def parsed(elementClass: ElementClass.Value): JsonMapping =
    MappingService.parseMapping(mappingJson.getBytes, elementClass).get("test mapping must parse")

  private def applyNatively(ids: Seq[Long], elementClass: ElementClass.Value): Seq[Long] = {
    val mapped =
      MappingService.applyMappingToBytes(parsed(elementClass), encode(ids, elementClass), elementClass, bucketScanner)
    decode(mapped, elementClass)
  }

  // Expected results per element class, as (input id -> mapped id) in the normalized representation.
  private val expectedMappings: Seq[(ElementClass.Value, Seq[(Long, Long)])] = Seq(
    // 300 and 44 are the same id, the later class [5, 44] wins. -1 is 255, 70000 is 112, 4294967296 is 0 and -2 is 254.
    ElementClass.uint8 -> Seq(0L -> 254L, 2L -> 1L, 44L -> 5L, 255L -> 7L, 112L -> 7L, 6L -> 254L, 12L -> 12L),
    ElementClass.int8 -> Seq(0L -> -2L, 2L -> 1L, 44L -> 5L, -1L -> 7L, 112L -> 7L, 6L -> -2L, 12L -> 12L),
    // For widths up to 32 bits, 4294967296 truncates to 0, so the last class overrides 0 -> 10 with 0 -> -2.
    ElementClass.uint16 -> Seq(0L -> 65534L, 44L -> 5L, 300L -> 7L, 65535L -> 7L, 4464L -> 7L, 6L -> 65534L),
    ElementClass.int16 -> Seq(0L -> -2L, 44L -> 5L, 300L -> 7L, -1L -> 7L, 4464L -> 7L, 12L -> 12L),
    ElementClass.uint32 -> Seq(0L -> 4294967294L, 11L -> 10L, 300L -> 7L, 4294967295L -> 7L, 6L -> 4294967294L),
    ElementClass.int32 -> Seq(0L -> -2L, 11L -> 10L, 70000L -> 7L, -1L -> 7L, 12L -> 12L),
    ElementClass.uint64 -> Seq(0L -> 10L, 4294967296L -> -2L, -1L -> 7L, 6L -> -2L, 44L -> 5L, 12L -> 12L),
    ElementClass.int64 -> Seq(0L -> 10L, 4294967296L -> -2L, -1L -> 7L, Long.MinValue -> Long.MinValue)
  )

  "JSON mapping application" should {
    expectedMappings.foreach { case (elementClass, expected) =>
      s"map voxels and single segment ids to the expected ids for $elementClass" in {
        val (inputs, outputs) = expected.unzip
        assert(applyNatively(inputs, elementClass) == outputs)
        val mapping = parsed(elementClass)
        inputs.zip(outputs).foreach { case (input, output) =>
          assert(mapping(MappingService.normalizeSegmentId(input, elementClass)) == output)
        }
      }
    }

    ElementClass.segmentationElementClasses.toSeq.sortBy(_.id).foreach { elementClass =>
      s"map random data like a per-voxel lookup for $elementClass" in {
        val random = new Random(elementClass.id)
        val mapping = parsed(elementClass)
        Seq(0, 1, 32 * 32 * 32).foreach { voxelCount =>
          val ids = randomIds(voxelCount, random)
          val perVoxel = ids.map(id => mapping(MappingService.normalizeSegmentId(id, elementClass)))
          assert(applyNatively(ids, elementClass) == perVoxel)
        }
      }
    }

    "normalize segment ids to the element width" in {
      assert(MappingService.normalizeSegmentId(300, ElementClass.uint8) == 44)
      assert(MappingService.normalizeSegmentId(255, ElementClass.int8) == -1)
      assert(MappingService.normalizeSegmentId(-1, ElementClass.uint16) == 65535)
      assert(MappingService.normalizeSegmentId(-1, ElementClass.uint64) == -1)
    }
  }
}
