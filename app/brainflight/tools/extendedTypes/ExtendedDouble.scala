package brainflight.tools.extendedTypes

import brainflight.tools.Math._
import java.nio.ByteBuffer

class ExtendedDouble( d: Double ) {

  def patchAbsoluteValue =
    if ( d >= 0 )
      d + EPSILON
    else
      d - EPSILON

  def isNearZero =
    d <= EPSILON && d >= -EPSILON

  def toBinary = {
    val binary = new Array[Byte]( 8 )
    ByteBuffer.wrap( binary ).putDouble( d )
    binary
  }
}