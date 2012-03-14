package brainflight.tools.extendedTypes

import java.nio.ByteBuffer

class ExtendedInt( i: Int ) {
  def toBinary = {
    val binary = new Array[Byte]( 4 )
    ByteBuffer.wrap( binary ).putInt( i )
    binary
  }
}