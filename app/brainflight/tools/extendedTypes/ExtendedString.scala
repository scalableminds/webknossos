package brainflight.tools.extendedTypes

import java.nio.ByteBuffer

class ExtendedString(s: String) {

  def toFloatOpt = try {
    Some(s.toFloat)
  } catch {
    case _: java.lang.NumberFormatException => None
  }
  
  def toIntOpt = try {
    Some(s.toInt)
  } catch {
    case _: java.lang.NumberFormatException => None
  }
}