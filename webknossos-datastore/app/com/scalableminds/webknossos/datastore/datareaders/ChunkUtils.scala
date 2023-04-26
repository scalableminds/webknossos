package com.scalableminds.webknossos.datastore.datareaders

import com.typesafe.scalalogging.LazyLogging

object ChunkUtils extends LazyLogging {
  def computeChunkIndices(arrayShape: Array[Int],
                          arrayChunkSize: Array[Int],
                          selectedShape: Array[Int],
                          selectedOffset: Array[Int]): List[Array[Int]] = {
    val nDims = arrayShape.length
    val start = new Array[Int](nDims)
    val to = new Array[Int](nDims)
    var numChunks = 1
    for (dim <- 0 until nDims) {
      val largestPossibleIndex = (arrayShape(dim) - 1) / arrayChunkSize(dim)
      val smallestPossibleIndex = 0
      val startIndexRaw = selectedOffset(dim) / arrayChunkSize(dim)
      val startIndexClamped = Math.max(smallestPossibleIndex, Math.min(largestPossibleIndex, startIndexRaw))
      val toIndexRaw = (selectedOffset(dim) + selectedShape(dim) - 1) / arrayChunkSize(dim)
      val toIndexClampedToBbox = Math.max(smallestPossibleIndex, Math.min(largestPossibleIndex, toIndexRaw))
      val toIndexClamped = Math.max(startIndexClamped, toIndexClampedToBbox) // to index must be greater or equal to start index
      start(dim) = startIndexClamped
      to(dim) = toIndexClamped
      val numChunksForDim = toIndexClamped - startIndexClamped + 1
      numChunks *= numChunksForDim
    }

    val chunkIndices = new Array[Array[Int]](numChunks)
    val currentIndex = start.clone
    for (i <- chunkIndices.indices) {
      chunkIndices(i) = currentIndex.clone
      var dimIdx = nDims - 1
      while ({ dimIdx >= 0 }) if (currentIndex(dimIdx) >= to(dimIdx)) {
        currentIndex(dimIdx) = start(dimIdx)
        dimIdx -= 1
      } else {
        currentIndex(dimIdx) += 1
        dimIdx = -1
      }
    }
    chunkIndices.toList
  }
}
