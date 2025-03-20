package com.scalableminds.util.tools

trait ByteUtils {
  protected def isAllZero(data: Array[Byte]): Boolean =
    data.forall { byte: Byte =>
      byte == 0
    }

  /**
    *
    * @param l a 64 bit number
    * @return l as array of 8 bytes, little endian
    */
  def longToBytes(l: Long): Array[Byte] = {
    var w = l
    val result = new Array[Byte](8)
    for (i <- 7 to 0 by -1) {
      result(i) = (w & 0xFF).toByte
      w >>= 8
    }
    result.reverse
  }

  /**
    *
    * @param i a 32 bit number
    * @return i as array of 8 bytes, little endian
    */
  def intToBytes(i: Int): Array[Byte] = {
    var w = i
    val result = new Array[Byte](4)
    for (i <- 3 to 0 by -1) {
      result(i) = (w & 0xFF).toByte
      w >>= 4
    }
    result.reverse
  }
}
