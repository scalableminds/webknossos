package com.scalableminds.webknossos.tracingstore.tracings

/*

Based on https://github.com/gojuno/morton-js. See License below.

Copyright (c) 2016, Juno Inc.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

1. Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// May be moved to webknossos wrap (WKWMortonHelper)
trait MortonNDHelper {

  def mortonBits = 16 // 16 is the maximum value for 4 dimensions (16 * 4 = 64)

  private case class MortonVariables(lshifts: Seq[Long], masks: Seq[Long])

  private def getShiftsAndMasks(dimensions: Int, bits: Int): MortonVariables = {
    var shift = math.pow(2, math.floor(math.log(dimensions * (bits - 1)) / math.log(2))).toLong
    var masks: Seq[Long] = Seq(((1L << bits) - 1))
    var lshifts: Seq[Long] = Seq(0L)
    while (shift > 0) {
      var mask = 0L
      var shifted = 0L
      for (bit <- 0 until bits) {
        val distance = (dimensions * bit) - bit
        shifted |= shift & distance
        mask |= 1L << bit << ((~(shift - 1)) & distance)
      }
      if (shifted != 0) {
        masks = masks :+ mask
        lshifts = lshifts :+ shift
      }
      shift >>>= 1

    }
    MortonVariables(lshifts, masks)
  }

  protected def mortonEncode(position: Array[Int]): Long = {

    val variables = getShiftsAndMasks(position.length, mortonBits)
    var morton = 0L
    for (i <- position.indices) {
      var result = position(i).toLong
      for (o <- variables.masks.indices) {
        result = (result | (result << variables.lshifts(o))) & variables.masks(o)
      }
      morton |= (result << i)
    }
    morton
  }

  protected def mortonDecode(mortonIndex: Long, dimensions: Int): Array[Int] = {
    var morton = mortonIndex
    val position = Array.fill(dimensions)(0)
    var bit = 0

    while (morton > 0) {
      for (i <- 0 until dimensions) {
        position(i) |= ((morton & 1) << bit).toInt
        morton >>= 1
      }
      bit += 1
    }
    position
  }

}
