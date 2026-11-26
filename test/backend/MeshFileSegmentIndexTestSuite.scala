package backend

import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.webknossos.datastore.services.mesh.ZarrMeshFileService
import org.scalatest.wordspec.AsyncWordSpec

class MeshFileSegmentIndexTestSuite extends AsyncWordSpec {

  "ZarrMeshFileService.lastIndexLessOrEqual" should {
    "find the inner node entry a segment id falls into" in {
      val innerNodes = Array(3L, 10L, 25L, 0L) // the last entry is beyond the valid length
      assert(ZarrMeshFileService.lastIndexLessOrEqual(innerNodes, 1, 3, 2L) == -1)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(innerNodes, 1, 3, 3L) == 0)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(innerNodes, 1, 3, 24L) == 1)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(innerNodes, 1, 3, 1000L) == 2)
    }

    "compare segment ids as unsigned" in {
      val innerNodes = Array(1L, Long.MaxValue, -2L) // -2L is 2^64 - 2
      assert(ZarrMeshFileService.lastIndexLessOrEqual(innerNodes, 1, 3, -1L) == 2)
      assert(ZarrMeshFileService.lastIndexLessOrEqual(innerNodes, 1, 3, Long.MinValue) == 1)
    }
  }

  "ZarrMeshFileService.positionsInInnerNodeLayer" should {
    "descend through several inner node layers to the leaf chunk of each segment id" in {
      val entriesPerChunk = 4
      val leafSegmentIds = (1L to 100L).map(_ * 10).toArray
      def firstEntriesOfChunks(values: Array[Long]) = values.grouped(entriesPerChunk).map(_.head).toArray
      def chunked(values: Array[Long]): Map[Long, Array[Long]] =
        values
          .grouped(entriesPerChunk)
          .zipWithIndex
          .map { case (chunk, i) => i.toLong -> chunk.padTo(entriesPerChunk, 0L) }
          .toMap
      // Inner node layers, root first; each entry is the first segment id of a chunk of the layer below.
      var innerNodeLayers = List(firstEntriesOfChunks(leafSegmentIds))
      while (innerNodeLayers.head.length > entriesPerChunk)
        innerNodeLayers = firstEntriesOfChunks(innerNodeLayers.head) :: innerNodeLayers
      assert(innerNodeLayers.map(_.length) == List(2, 7, 25))

      val segmentIds = (0L to 1010L).toArray
      val leafChunks = innerNodeLayers.foldLeft(segmentIds.map(_ => 0L)) { (upperLayerPositions, layer) =>
        ZarrMeshFileService.positionsInInnerNodeLayer(
          chunked(layer),
          entriesPerChunk,
          layer.length,
          upperLayerPositions,
          segmentIds
        )
      }
      val expected = segmentIds.map { segmentId =>
        val index = leafSegmentIds.lastIndexWhere(_ <= segmentId)
        if (index < 0) -1L else (index / entriesPerChunk).toLong
      }
      assert(leafChunks.toSeq == expected.toSeq)
    }
  }

  "ZarrMeshFileService.indexOfLeaf" should {
    "find leaves in a C-ordered chunk" in {
      val leaves = Array(2L, 0L, 5L, 9L, 7L, 9L, 12L, 20L, 0L, 0L, 0L, 0L)
      assert(ZarrMeshFileService.indexOfLeaf(leaves, 4, 2, 7L) == 1)
      assert(ZarrMeshFileService.indexOfLeaf(leaves, 4, 2, 2L) == 0)
      assert(ZarrMeshFileService.indexOfLeaf(leaves, 4, 2, 3L) == -1)
      assert(ZarrMeshFileService.indexOfLeaf(leaves, 4, 2, 0L) == -1) // only padding contains 0
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

  "ZarrMeshFileService.copyRanges" should {
    "fail only the ranges that cover a chunk that could not be read" in {
      val chunkBoxes: Map[Long, Box[Array[Byte]]] =
        Map(0L -> Full(Array[Byte](0, 1, 2, 3)), 1L -> Failure("read error"), 2L -> Full(Array[Byte](8, 9, 0, 0)))
      val ranges = ZarrMeshFileService.copyRanges(chunkBoxes, 4, Seq((0L, 2L), (2L, 6L), (6L, 9L), (8L, 10L)))
      assert(
        ranges.map(_.map(_.toSeq)) == Seq(
          Full(Seq[Byte](0, 1)),
          Failure("read error"),
          Failure("read error"),
          Full(Seq[Byte](8, 9))
        )
      )
    }
  }

  /* The run of a mapping level around index in segment mesh metadata with the given levels, in chunks of 4 segments,
   * and the chunk spans read for it, starting with initialRunChunks like readRunChunks.
   */
  private def findRun(levels: Array[Long], index: Long, level: Int): ((Long, Long), List[(Long, Long)]) = {
    val chunks = levels
      .grouped(4)
      .zipWithIndex
      .map { case (chunkLevels, chunk) =>
        chunk.toLong -> chunkLevels.flatMap(level => Array(0L, 0L, 0L, 0L, level)).padTo(20, 0L)
      }
      .toMap
    val maxSegmentLevelPerChunk = levels.grouped(4).map(_.max.toByte).toArray
    def readSpans(span: (Long, Long), spansRead: List[(Long, Long)]): ((Long, Long), List[(Long, Long)]) =
      ZarrMeshFileService.runAround(
        chunks,
        maxSegmentLevelPerChunk,
        4,
        5,
        levels.length,
        span._1,
        span._2,
        index,
        level
      ) match {
        case Right(run)     => (run, (span :: spansRead).reverse)
        case Left(nextSpan) => readSpans(nextSpan, span :: spansRead)
      }
    readSpans(ZarrMeshFileService.initialRunChunks(maxSegmentLevelPerChunk, index / 4, level), Nil)
  }

  "ZarrMeshFileService.runAround" should {
    "find the run of a mapping level around an index" in {
      // Runs start at indices 0, 3 and 7 at level 0, at 0 and 7 at level 1 and at 0 at level 2.
      val levels = Array(255L, 0, 0, 1, 0, 0, 0, 2, 0, 0)
      assert(findRun(levels, 1, 0)._1 == (0L, 3L))
      assert(findRun(levels, 5, 0)._1 == (3L, 7L))
      assert(findRun(levels, 8, 0)._1 == (7L, 10L))
      assert(findRun(levels, 5, 1)._1 == (0L, 7L))
      assert(findRun(levels, 9, 2)._1 == (0L, 10L))
    }

    // Runs start at indices 0, 13 and 15, so chunk 3 holds a run of two segments between runs over several chunks.
    val levelsWithLongNeighbors = Array.tabulate(28)(i => if (i == 0) 255L else if (i == 13 || i == 15) 1L else 0L)

    "read only the seed's chunk for a short run between long ones" in
      assert(findRun(levelsWithLongNeighbors, 14, 0) == ((13L, 15L), List((3L, 3L))))

    "read further chunks only once the run continues into them" in {
      assert(findRun(levelsWithLongNeighbors, 12, 0) == ((0L, 13L), List((3L, 3L), (0L, 3L))))
      assert(findRun(levelsWithLongNeighbors, 15, 0) == ((15L, 28L), List((3L, 3L), (3L, 6L))))
      assert(findRun(levelsWithLongNeighbors, 6, 0) == ((0L, 13L), List((0L, 3L))))
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
      assert(ZarrMeshFileService.evenlySpaced(Set(3L, 1L, 2L), 8) == Seq(1L, 2L, 3L))
      assert(ZarrMeshFileService.evenlySpaced((0L until 100L).toSet, 4) == Seq(0L, 25L, 50L, 75L))
    }
  }
}
