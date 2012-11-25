package brainflight.tools.extendedTypes

import brainflight.tools.Math._
import java.nio.ByteBuffer

class ExtendedDouble( d: Double ) {
  /**
   * Patches the value of this double (used during arithmetic operations
   * which may result in slightly incorrect result. To ensure correct 
   * rounding an epsilon is added/subtracted)
   */
  def patchAbsoluteValue =
    if ( d >= 0 )
      d + EPSILON
    else
      d - EPSILON

  /**
   * Tests if the value is near zero
   */
  def isNearZero =
    d <= EPSILON && d >= -EPSILON

  /**
   * Makes sure the double is in the given interval.
   */
  def clamp(low: Double, high: Double) = 
    math.min(high, math.max(low, d))

  /**
   * Converts this double into an array of bytes
   */
  def toBinary = {
    val binary = new Array[Byte]( 8 )
    ByteBuffer.wrap( binary ).putDouble( d )
    binary
  }
}