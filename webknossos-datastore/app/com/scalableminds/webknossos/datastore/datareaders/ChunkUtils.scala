package com.scalableminds.webknossos.datastore.datareaders

object ChunkUtils {
  def computeChunkIndices(arrayShapeOpt: Option[Array[Int]],
                          arrayChunkShape: Array[Int],
                          selectedShape: Array[Int],
                          selectedOffset: Array[Int]): List[Array[Int]] = {
    val nDims = arrayChunkShape.length
    val start = new Array[Int](nDims)
    val end = new Array[Int](nDims)
    var numChunks = 1
    for (dim <- 0 until nDims) {
      val largestPossibleIndex = arrayShapeOpt.map(arrayShape => (arrayShape(dim) - 1) / arrayChunkShape(dim))
      val smallestPossibleIndex = 0
      val startIndexRaw = selectedOffset(dim) / arrayChunkShape(dim)
      val startIndexClamped =
        Math.max(smallestPossibleIndex, Math.min(largestPossibleIndex.getOrElse(startIndexRaw), startIndexRaw))
      val endIndexRaw = (selectedOffset(dim) + selectedShape(dim) - 1) / arrayChunkShape(dim)
      val endIndexClampedToBbox =
        Math.max(smallestPossibleIndex, Math.min(largestPossibleIndex.getOrElse(endIndexRaw), endIndexRaw))
      val endIndexClamped = Math.max(startIndexClamped, endIndexClampedToBbox) // end index must be greater or equal to start index
      start(dim) = startIndexClamped
      end(dim) = endIndexClamped
      val numChunksForDim = endIndexClamped - startIndexClamped + 1
      numChunks *= numChunksForDim
    }

    val chunkIndices = new Array[Array[Int]](numChunks)
    val currentIndex = start.clone
    for (i <- chunkIndices.indices) {
      chunkIndices(i) = currentIndex.clone
      var dimIndex = nDims - 1
      while ({ dimIndex >= 0 }) if (currentIndex(dimIndex) >= end(dimIndex)) {
        currentIndex(dimIndex) = start(dimIndex)
        dimIndex -= 1
      } else {
        currentIndex(dimIndex) += 1
        dimIndex = -1
      }
    }
    chunkIndices.toList
  }
}
