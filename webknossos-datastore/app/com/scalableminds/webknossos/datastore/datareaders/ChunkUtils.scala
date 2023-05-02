package com.scalableminds.webknossos.datastore.datareaders

import com.typesafe.scalalogging.LazyLogging

object ChunkUtils extends LazyLogging {
  def computeChunkIndices(arrayShape: Array[Int],
                          arrayChunkSize: Array[Int],
                          selectedShape: Array[Int],
                          selectedOffset: Array[Int]): List[Array[Int]] = {
    val nDims = arrayShape.length
    val start = new Array[Int](nDims)
    val end = new Array[Int](nDims)
    var numChunks = 1
    for (dim <- 0 until nDims) {
      val largestPossibleIndex = (arrayShape(dim) - 1) / arrayChunkSize(dim)
      val smallestPossibleIndex = 0
      val startIndexRaw = selectedOffset(dim) / arrayChunkSize(dim)
      val startIndexClamped = Math.max(smallestPossibleIndex, Math.min(largestPossibleIndex, startIndexRaw))
      val endIndexRaw = (selectedOffset(dim) + selectedShape(dim) - 1) / arrayChunkSize(dim)
      val endIndexClampedToBbox = Math.max(smallestPossibleIndex, Math.min(largestPossibleIndex, endIndexRaw))
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
