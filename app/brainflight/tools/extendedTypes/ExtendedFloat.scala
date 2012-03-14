package brainflight.tools.extendedTypes

import java.nio.ByteBuffer

class ExtendedFloat( f: Float ) {
  def toBinary = {
    val binary = new Array[Byte]( 4 )
    ByteBuffer.wrap( binary ).putFloat( f )
    binary
  }
}