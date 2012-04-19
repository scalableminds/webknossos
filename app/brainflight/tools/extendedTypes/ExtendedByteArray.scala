package brainflight.tools.extendedTypes

import java.nio.ByteBuffer
import scala.math._


class ExtendedByteArray( b: Array[Byte] ) {
  /**
   * Converts this array of bytes to one float value
   */
  def toFloat = {
    if ( b != null && b.size == 4 )
      ByteBuffer.wrap( b ).getFloat
    else
      Float.NaN
  }
  
  /**
   * Converts this array of bytes to one int value
   */
  def toIntFromFloat = toFloat.toInt

  /**
   * Splits this collection into smaller sub-arrays each containing exactly 
   * subCollectionSize entries (except the last sub-array which may contain less)
   */
  def subDivide( subCollectionSize: Int ): Array[Array[Byte]] = 
    b.sliding( subCollectionSize, subCollectionSize ).toArray
}