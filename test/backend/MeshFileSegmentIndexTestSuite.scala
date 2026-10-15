package backend

import com.scalableminds.webknossos.datastore.datareaders.ChunkReadCoalescing
import com.scalableminds.webknossos.datastore.datareaders.ChunkReadCoalescing.ChunkByteRange
import com.scalableminds.webknossos.datastore.services.mesh.ZarrMeshFileService
import org.scalatest.wordspec.AsyncWordSpec

class MeshFileSegmentIndexTestSuite extends AsyncWordSpec {

  private def requestRanges(chunks: Seq[ChunkByteRange], coalescing: ChunkReadCoalescing) =
    ChunkReadCoalescing.coalesce(chunks, coalescing).map(r => (r.start, r.endExclusive, r.chunks.map(_.key)))

  private val chunks = Seq(
    ChunkByteRange(key = 2, start = 300, endExclusive = 400),
    ChunkByteRange(key = 0, start = 0, endExclusive = 100),
    ChunkByteRange(key = 1, start = 100, endExclusive = 200),
    ChunkByteRange(key = 3, start = 1000, endExclusive = 1100)
  )

  "ChunkReadCoalescing.coalesce" should {
    "read each chunk separately when disabled" in {
      val requests = requestRanges(chunks, ChunkReadCoalescing(-1, 1 << 20, 32))
      assert(requests.map(_._3) == Seq(Seq(0), Seq(1), Seq(2), Seq(3)))
    }

    "merge only touching chunks with a gap of 0" in {
      val requests = requestRanges(chunks, ChunkReadCoalescing(0, 1 << 20, 32))
      assert(requests == Seq((0L, 200L, Seq(0, 1)), (300L, 400L, Seq(2)), (1000L, 1100L, Seq(3))))
    }

    "merge chunks across gaps up to maxGapBytes" in {
      val requests = requestRanges(chunks, ChunkReadCoalescing(100, 1 << 20, 32))
      assert(requests == Seq((0L, 400L, Seq(0, 1, 2)), (1000L, 1100L, Seq(3))))
    }

    "not extend requests beyond maxRequestBytes" in {
      val requests = requestRanges(chunks, ChunkReadCoalescing(1000, 250, 32))
      assert(requests == Seq((0L, 200L, Seq(0, 1)), (300L, 400L, Seq(2)), (1000L, 1100L, Seq(3))))
    }
  }

  "ZarrMeshFileService.lastIndexLessOrEqual" should {
    "find the fence entry a segment id falls into" in {
      val fence = Array(3L, 10L, 25L, 0L) // the last entry is beyond the valid length
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 3, 2L) == -1)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 3, 3L) == 0)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 3, 24L) == 1)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 3, 1000L) == 2)
    }

    "compare segment ids as unsigned" in {
      val fence = Array(1L, Long.MaxValue, -2L) // -2L is 2^64 - 2
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 3, -1L) == 2)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(fence, 3, Long.MinValue) == 1)
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
      val bytesByChunk = Map(0L -> Array[Byte](0, 1, 2, 3), 1L -> Array[Byte](4, 5, 6, 7), 2L -> Array[Byte](8, 9, 0, 0))
      assert(ZarrMeshFileService.copyRange(bytesByChunk, 4, 2, 10).toSeq == Seq[Byte](2, 3, 4, 5, 6, 7, 8, 9))
      assert(ZarrMeshFileService.copyRange(bytesByChunk, 4, 5, 5).isEmpty)
    }
  }
}
