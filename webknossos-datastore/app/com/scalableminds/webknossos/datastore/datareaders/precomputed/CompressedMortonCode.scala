package com.scalableminds.webknossos.datastore.datareaders.precomputed

import scala.math.log10

object CompressedMortonCode {

  def log2(x: Double): Double = log10(x) / log10(2.0)

  def encode(position: Array[Int], gridSize: Array[Int]): Long = {
    /*
        Computes the compressed morton code as per
        https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/volume.md#compressed-morton-code
        https://github.com/google/neuroglancer/blob/162b698f703c86e0b3e92b8d8e0cacb0d3b098df/src/neuroglancer/util/zorder.ts#L72
     */
    val bits = gridSize.map(log2(_).ceil.toInt)
    val maxBits = bits.max
    var outputBit = 0L
    val one = 1L

    var output = 0L
    for (bit <- 0 to maxBits) {
      if (bit < bits(0)) {
        output |= (((position(0) >> bit) & one) << outputBit)
        outputBit += 1
      }
      if (bit < bits(1)) {
        output |= (((position(1) >> bit) & one) << outputBit)
        outputBit += 1
      }
      if (bit < bits(2)) {
        output |= (((position(2) >> bit) & one) << outputBit)
        outputBit += 1
      }
    }

    output
  }

}
