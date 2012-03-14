package brainflight.tools.extendedTypes

import java.nio.ByteBuffer
import scala.math._


class ExtendedByteArray( b: Array[Byte] ) {
  def toFloat = {
    if ( b != null && b.size == 4 )
      ByteBuffer.wrap( b ).getFloat
    else
      Float.NaN
  }
  
  def toIntFromFloat = toFloat.toInt

  def subDivide( subCollectionSize: Int ): Array[Array[Byte]] = b.size match {
    case 0 =>
      new Array( 0 )
    case s if s <= subCollectionSize =>
      Array( b )
    case _ =>
      val arraySize =
        if ( b.size % subCollectionSize == 0 )
          b.size / subCollectionSize
        else
          b.size / subCollectionSize + 1

      val fragments = new Array[Array[Byte]]( arraySize )

      for ( i <- 0 until b.size by subCollectionSize ) {
        val subCollection = b.slice( i, min( i + subCollectionSize, b.size ) )
        fragments.update( i / subCollectionSize, subCollection )
      }
      fragments
  }
}