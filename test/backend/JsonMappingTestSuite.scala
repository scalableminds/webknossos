package backend

import com.scalableminds.webknossos.datastore.helpers.NativeBucketScanner
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.services.mapping.{JsonMapping, MappingParser, MappingService}
import org.scalatestplus.play.PlaySpec

import java.nio.{ByteBuffer, ByteOrder}
import scala.reflect.ClassTag
import scala.util.Random

class JsonMappingTestSuite extends PlaySpec {

  private val bucketScanner = new NativeBucketScanner()

  // Ids include values that exceed narrow element widths (300 == 44 as uint8), negative values (-1 == 255 as uint8),
  // a mapping of 0 and duplicate keys after truncation (300 and 44), where the later class wins.
  private val mappingJson =
    """{"name": "test", "classes": [[1, 2, 3, 4], [10, 0, 11], [7, 300, -1, 70000], [5, 44], [-2, 6, 4294967296]]}"""

  private val segmentIdPool: Seq[Long] =
    Seq(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 44, 255, 300, 70000, 4464, -1, -2, 4294967296L, Long.MinValue)

  private def randomData(elementClass: ElementClass.Value, voxelCount: Int, random: Random): Array[Byte] = {
    val bytesPerElement = ElementClass.bytesPerElement(elementClass)
    val buffer = ByteBuffer.allocate(voxelCount * bytesPerElement).order(ByteOrder.LITTLE_ENDIAN)
    (0 until voxelCount).foreach { _ =>
      val id = if (random.nextInt(4) == 0) random.nextLong() else segmentIdPool(random.nextInt(segmentIdPool.length))
      val longBytes = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(id).array()
      buffer.put(longBytes, 0, bytesPerElement)
    }
    buffer.array()
  }

  // The previous implementation: parse into a typed Map and map every voxel through it, with identity as default.
  private def referenceTyped[T: ClassTag](
      data: Array[Byte],
      bytesPerElement: Int,
      fromLong: Long => T,
      read: ByteBuffer => T,
      write: (ByteBuffer, T) => Unit
  ): Array[Byte] = {
    val mapping = MappingParser.parse[T](mappingJson.getBytes, fromLong).get("test mapping must parse")
    val typedMapping = mapping.mapping.withDefault(identity)
    val inBuffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
    val typedData = Array.fill(data.length / bytesPerElement)(read(inBuffer))
    val mappedData = typedData.map(typedMapping.apply)
    val outBuffer = ByteBuffer.allocate(data.length).order(ByteOrder.LITTLE_ENDIAN)
    mappedData.foreach(write(outBuffer, _))
    outBuffer.array()
  }

  private def reference(data: Array[Byte], elementClass: ElementClass.Value): Array[Byte] =
    ElementClass.bytesPerElement(elementClass) match {
      case 1 => referenceTyped[Byte](data, 1, _.toByte, _.get, _.put(_))
      case 2 => referenceTyped[Short](data, 2, _.toShort, _.getShort, _.putShort(_))
      case 4 => referenceTyped[Int](data, 4, _.toInt, _.getInt, _.putInt(_))
      case 8 => referenceTyped[Long](data, 8, identity, _.getLong, _.putLong(_))
    }

  private def parsed(elementClass: ElementClass.Value): JsonMapping =
    MappingService.parseMapping(mappingJson.getBytes, elementClass).get("test mapping must parse")

  "JSON mapping application" should {
    ElementClass.segmentationElementClasses.toSeq.sortBy(_.id).foreach { elementClass =>
      s"match the previous per-voxel implementation for $elementClass" in {
        val random = new Random(elementClass.id)
        val mapping = parsed(elementClass)
        Seq(0, 1, 32 * 32 * 32).foreach { voxelCount =>
          val data = randomData(elementClass, voxelCount, random)
          val mapped = MappingService.applyMappingToBytes(mapping, data, elementClass, bucketScanner)
          assert(mapped.sameElements(reference(data, elementClass)))
        }
      }
    }

    "map 0 when it is part of the mapping and keep unmapped ids" in {
      // As uint32, 4294967296 truncates to 0, so the last class overrides 0 -> 10 with 0 -> -2 (i.e. 2^32 - 2)
      val data = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN).putInt(0).putInt(2).putInt(12).putInt(-1)
      val mapped = MappingService.applyMappingToBytes(
        parsed(ElementClass.uint32),
        data.array(),
        ElementClass.uint32,
        bucketScanner
      )
      val out = ByteBuffer.wrap(mapped).order(ByteOrder.LITTLE_ENDIAN)
      assert(Seq.fill(4)(out.getInt) == Seq(-2, 1, 12, 7))
    }

    "map single segment ids like the voxel data" in {
      val uint8Mapping = parsed(ElementClass.uint8)
      // 300 is 44 as uint8, which is mapped to 5 by the later class
      val normalized = MappingService.normalizeSegmentId(300, ElementClass.uint8)
      assert(normalized == 44)
      assert(uint8Mapping(normalized) == 5)
      assert(MappingService.normalizeSegmentId(255, ElementClass.int8) == -1)
      assert(MappingService.normalizeSegmentId(-1, ElementClass.uint16) == 65535)
      assert(MappingService.normalizeSegmentId(-1, ElementClass.uint64) == -1)
    }
  }
}
