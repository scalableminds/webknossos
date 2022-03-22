package com.scalableminds.webknossos.datastore.jzarr

object ChunkUtils {
  def computeChunkIndices(arrayShape: Array[Int],
                          arrayChunkSize: Array[Int],
                          selectedShape: Array[Int],
                          selectedOffset: Array[Int]): Array[Array[Int]] = {
    val depth = arrayShape.length
    val start = new Array[Int](depth)
    val to = new Array[Int](depth)
    var numChunks = 1
    for (dim <- 0 until depth) {
      val startIdx = selectedOffset(dim) / arrayChunkSize(dim)
      val maxIdx = (arrayShape(dim) - 1) / arrayChunkSize(dim)
      var toIdx = (selectedOffset(dim) + selectedShape(dim) - 1) / arrayChunkSize(dim)
      toIdx = Math.min(toIdx, maxIdx)
      start(dim) = startIdx
      to(dim) = toIdx
      numChunks *= (toIdx - startIdx + 1)
    }
    val chunkIndices = new Array[Array[Int]](numChunks)
    val currentIdx = start.clone
    for (i <- chunkIndices.indices) {
      chunkIndices(i) = currentIdx.clone
      var depthIdx = depth - 1
      while ({ depthIdx >= 0 }) if (currentIdx(depthIdx) >= to(depthIdx)) {
        currentIdx(depthIdx) = start(depthIdx)
        depthIdx -= 1
      } else {
        currentIdx(depthIdx) += 1
        depthIdx = -1
      }
    }
    chunkIndices
  }
}
