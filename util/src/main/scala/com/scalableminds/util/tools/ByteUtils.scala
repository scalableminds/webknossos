package com.scalableminds.util.tools

trait ByteUtils {
  protected def isAllZero(data: Array[Byte]): Boolean =
    data.forall { byte: Byte =>
      byte == 0
    }
}
