package com.scalableminds.webknossos.datastore.dataformats.wkw

trait MortonEncoding {

  protected def mortonEncode(x: Int, y: Int, z: Int): Int = {
    var morton = 0
    val bitLength = math.ceil(math.log(List(x, y, z).max + 1) / math.log(2)).toInt

    (0 until bitLength).foreach { i =>
      morton |= ((x & (1 << i)) << (2 * i)) |
        ((y & (1 << i)) << (2 * i + 1)) |
        ((z & (1 << i)) << (2 * i + 2))
    }
    morton
  }

}
