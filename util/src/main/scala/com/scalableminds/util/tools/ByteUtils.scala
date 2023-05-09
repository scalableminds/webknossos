package com.scalableminds.util.tools

trait ByteUtils {
  protected def isAllZero(data: Array[Byte]): Boolean =
    data.forall { byte: Byte =>
      byte == 0
    }

  protected def longToBytes(l: Long): Array[Byte] = {
    var w = l
    val result = new Array[Byte](8)
    for (i <- 7 to 0 by -1) {
      result(i) = (w & 0xFF).toByte
      w >>= 8
    }
    result.reverse
  }
}
