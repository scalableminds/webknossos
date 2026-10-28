package backend

import com.scalableminds.webknossos.datastore.services.mesh.ZarrMeshFileService
import org.scalatest.wordspec.AsyncWordSpec

class MeshFileSegmentIndexTestSuite extends AsyncWordSpec {

  "ZarrMeshFileService.lastIndexLessOrEqual" should {
    "find the fence entry a segment id falls into" in {
      val fence = Array(3L, 10L, 25L, 0L) // the last entry is beyond the valid length
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 1, 3, 2L) == -1)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 1, 3, 3L) == 0)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 1, 3, 24L) == 1)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 1, 3, 1000L) == 2)
    }

    "compare segment ids as unsigned" in {
      val fence = Array(1L, Long.MaxValue, -2L) // -2L is 2^64 - 2
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 1, 3, -1L) == 2)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 1, 3, Long.MinValue) == 1)
    }
  }

  "ZarrMeshFileService.indexOfRow" should {
    "find rows of a C-ordered index table" in {
      val table = Array(2L, 0L, 5L, 9L, 7L, 9L, 12L, 20L, 0L, 0L, 0L, 0L)
      assert(ZarrMeshFileService.indexOfRow(table, 4, 2, 7L) == 1)
      assert(ZarrMeshFileService.indexOfRow(table, 4, 2, 2L) == 0)
      assert(ZarrMeshFileService.indexOfRow(table, 4, 2, 3L) == -1)
      assert(ZarrMeshFileService.indexOfRow(table, 4, 2, 0L) == -1) // only padding rows contain 0
    }
  }

  "ZarrMeshFileService.copyRange" should {
    "assemble a range across chunks" in {
      val bytesByChunk =
        Map(0L -> Array[Byte](0, 1, 2, 3), 1L -> Array[Byte](4, 5, 6, 7), 2L -> Array[Byte](8, 9, 0, 0))
      assert(ZarrMeshFileService.copyRange(bytesByChunk, 4, 2, 10).toSeq == Seq[Byte](2, 3, 4, 5, 6, 7, 8, 9))
      assert(ZarrMeshFileService.copyRange(bytesByChunk, 4, 5, 5).isEmpty)
    }
  }

  // Rows of width 5 whose last column is the level; rows 0-9 with runs at level 0 starting at rows 0, 3 and 7.
  private val levels = Array(255L, 0, 0, 1, 0, 0, 0, 2, 0, 0)
  private val rowsPerChunk = 4L
  private val rowChunks: Map[Long, Array[Long]] = levels
    .grouped(4)
    .zipWithIndex
    .map { case (chunkLevels, chunk) =>
      chunk.toLong -> chunkLevels.flatMap(level => Array(0L, 0L, 0L, 0L, level)).padTo(20, 0L)
    }
    .toMap
  private val summary: Array[Byte] = levels.grouped(4).map(_.max.toByte).toArray

  "ZarrMeshFileService.runChunkSpan" should {
    "include neighboring chunks whose rows all continue the run" in {
      assert(ZarrMeshFileService.runChunkSpan(summary, 0, level = 0) == (0L, 1L))
      assert(ZarrMeshFileService.runChunkSpan(summary, 1, level = 0) == (0L, 2L))
      assert(ZarrMeshFileService.runChunkSpan(summary, 2, level = 2) == (0L, 2L))
    }
  }

  "ZarrMeshFileService.runAround" should {
    "find the run of a mapping level around a row" in {
      def run(row: Long, level: Int) = {
        val (first, last) = ZarrMeshFileService.runChunkSpan(summary, row / rowsPerChunk, level)
        ZarrMeshFileService.runAround(rowChunks, rowsPerChunk, 5, levels.length, first, last, row, level)
      }
      assert(run(1, 0) == (0L, 3L))
      assert(run(5, 0) == (3L, 7L))
      assert(run(8, 0) == (7L, 10L))
      assert(run(5, 1) == (0L, 7L))
      assert(run(9, 2) == (0L, 10L))
    }
  }

  "ZarrMeshFileService.percentileOfMappingName" should {
    "parse percentile mapping names" in {
      assert(ZarrMeshFileService.percentileOfMappingName("agglomerate_view_90").contains(90))
      assert(ZarrMeshFileService.percentileOfMappingName("agglomerate_view_65_zarr").contains(65))
      assert(ZarrMeshFileService.percentileOfMappingName("dataset-agglomerate_view_5").contains(5))
      assert(ZarrMeshFileService.percentileOfMappingName("agglomerate_view_custom").isEmpty)
      assert(ZarrMeshFileService.percentileOfMappingName("mapping_90").isEmpty)
    }
  }

  "ZarrMeshFileService.evenlySpaced" should {
    "pick seeds spread over the segment ids" in {
      assert(ZarrMeshFileService.evenlySpaced(Array(1L, 2L, 3L), 8) == Seq(1L, 2L, 3L))
      assert(ZarrMeshFileService.evenlySpaced((0L until 100L).toArray, 4) == Seq(0L, 25L, 50L, 75L))
    }
  }
}
