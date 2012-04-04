package brainflight.tools.extendedTypes

import java.nio.ByteBuffer

class ExtendedInt( i: Int ) {
  /**
   * Converts this int into an array of bytes
   */
  def toBinary = {
    val binary = new Array[Byte]( 4 )
    ByteBuffer.wrap( binary ).putInt( i )
    binary
  }
}