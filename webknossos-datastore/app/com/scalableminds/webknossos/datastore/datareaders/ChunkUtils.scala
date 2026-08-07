package com.scalableminds.webknossos.datastore.datareaders

object ChunkUtils {

  // Chunk indices are modelled as Long (rather than Int) because arrayShape/selectedOffset can span the
  // full uint64 range (e.g. a segment-id-keyed mapping array addressed by raw segment id, not by bounded
  // spatial voxel coordinates) -- with a realistic chunk shape, the resulting chunk index can exceed
  // Int.MaxValue (~2.1 billion) even though the chunk shape itself (an actual array held in memory) cannot.
  def computeChunkIndices(
      arrayShapeOpt: Option[Array[Long]],
      arrayChunkShape: Array[Int],
      selectedShape: Array[Int],
      selectedOffset: Array[Long]
  ): Seq[Array[Long]] = {
    val nDims = arrayChunkShape.length
    val start = new Array[Long](nDims)
    val end = new Array[Long](nDims)
    var numChunks = 1L
    for (dim <- 0 until nDims) {
      val largestPossibleIndex = arrayShapeOpt.map(arrayShape => (arrayShape(dim) - 1) / arrayChunkShape(dim))
      val smallestPossibleIndex = 0L
      val startIndexRaw = selectedOffset(dim) / arrayChunkShape(dim)
      val startIndexClamped =
        Math.max(smallestPossibleIndex, Math.min(largestPossibleIndex.getOrElse(startIndexRaw), startIndexRaw))
      val endIndexRaw = (selectedOffset(dim) + selectedShape(dim) - 1) / arrayChunkShape(dim)
      val endIndexClampedToBbox =
        Math.max(smallestPossibleIndex, Math.min(largestPossibleIndex.getOrElse(endIndexRaw), endIndexRaw))
      val endIndexClamped =
        Math.max(startIndexClamped, endIndexClampedToBbox) // end index must be greater or equal to start index
      start(dim) = startIndexClamped
      end(dim) = endIndexClamped
      val numChunksForDim = endIndexClamped - startIndexClamped + 1
      numChunks *= numChunksForDim
    }

    val chunkIndices = new Array[Array[Long]](Math.toIntExact(numChunks))
    val currentIndex = start.clone
    for (i <- chunkIndices.indices) {
      chunkIndices(i) = currentIndex.clone
      var dimIndex = nDims - 1
      while (dimIndex >= 0) if (currentIndex(dimIndex) >= end(dimIndex)) {
        currentIndex(dimIndex) = start(dimIndex)
        dimIndex -= 1
      } else {
        currentIndex(dimIndex) += 1
        dimIndex = -1
      }
    }
    chunkIndices.toSeq
  }
}
