package brainflight.tools.extendedTypes

import java.nio.ByteBuffer

class ExtendedFloat( f: Float ) {
  /**
   * Converts this float into an array of bytes
   */
  def toBinary = {
    val binary = new Array[Byte]( 4 )
    ByteBuffer.wrap( binary ).putFloat( f )
    binary
  }
}