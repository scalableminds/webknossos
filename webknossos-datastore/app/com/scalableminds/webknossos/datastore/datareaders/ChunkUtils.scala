package com.scalableminds.webknossos.datastore.datareaders

import com.typesafe.scalalogging.LazyLogging

object ChunkUtils extends LazyLogging {
  def computeChunkIndices(arrayShape: Array[Int],
                          arrayChunkSize: Array[Int],
                          selectedShape: Array[Int],
                          selectedOffset: Array[Int]): List[Array[Int]] = {
    val depth = arrayShape.length
    val start = new Array[Int](depth)
    val to = new Array[Int](depth)
    var numChunks = 1
    for (dim <- 0 until depth) {
      val maxIdx = (arrayShape(dim) - 1) / arrayChunkSize(dim)
      val startIdx = Math.min(maxIdx, selectedOffset(dim) / arrayChunkSize(dim))
      var toIdx = (selectedOffset(dim) + selectedShape(dim) - 1) / arrayChunkSize(dim)
      toIdx = Math.min(toIdx, maxIdx)
      start(dim) = startIdx
      to(dim) = toIdx
      val numChunksForDim = toIdx - startIdx + 1
      numChunks *= numChunksForDim
    }
    if (numChunks < 0) {
      logger.warn(
        s"Failed to compute zarr chunk indices. array shape ${arrayShape.toList}, chunkShape: ${arrayChunkSize.toList}, requested ${selectedShape.toList} at ${selectedOffset.toList}")
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
    chunkIndices.toList
  }
  /*
  def calculatePrecomputedChunks(arrayShape: Array[Int],
                                 arrayChunkSize: Array[Int],
                                 selectedShape: Array[Int],
                                 selectedOffset: Array[Int],
                                 mag: Vec3Int): Iterable[BoundingBox] = {

    val offset = (selectedOffset, mag.toList).zipped.map((o, m) => o / m)
    val requested = BoundingBox.fromOffsetAndShape(Vec3Int.fromList(offset.toList).getOrElse(Vec3Int(0, 0, 0)),
                                                   Vec3Int.fromList(selectedShape.toList).getOrElse(Vec3Int(0, 0, 0)))
    val boundingBox = BoundingBox(Vec3Int(0, 0, 0), arrayShape(0), arrayShape(1), arrayShape(2))
    val inside = requested.intersection(boundingBox)

    val chunkSize = Vec3Int.fromList(arrayChunkSize.toList).getOrElse(Vec3Int(0, 0, 0))

    inside match {
      case Some(inside) => {
        val aligned = (inside - boundingBox.topLeft).div(chunkSize) * chunkSize + boundingBox.topLeft
        aligned
          .range(chunkSize)
          .flatMap(chunkOffset => BoundingBox.fromOffsetAndShape(chunkOffset, chunkSize).intersection(boundingBox))
      }
      case _ => List()
    }
  }*/
}
