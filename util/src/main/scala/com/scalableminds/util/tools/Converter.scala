package com.scalableminds.util.tools

object DefaultConverters {
  implicit object StringToBoolean extends Converter[String, Boolean] {
    def convert(s: String): Option[Boolean] =
      try
        Some(s.toBoolean)
      catch {
        case _: java.lang.IllegalArgumentException => None
      }
  }

  implicit object StringToInt extends Converter[String, Int] {
    def convert(s: String): Option[Int] =
      try
        Some(s.toInt)
      catch {
        case _: java.lang.NumberFormatException => None
      }
  }

  implicit object StringToFloat extends Converter[String, Float] {
    def convert(s: String): Option[Float] =
      try
        Some(s.toFloat)
      catch {
        case _: java.lang.NumberFormatException => None
      }
  }

  implicit object StringToDouble extends Converter[String, Double] {
    def convert(s: String): Option[Double] =
      try
        Some(s.toDouble)
      catch {
        case _: java.lang.NumberFormatException => None
      }
  }

  implicit object StringToLong extends Converter[String, Long] {
    def convert(s: String): Option[Long] =
      try
        Some(s.toLong)
      catch {
        case _: java.lang.NumberFormatException => None
      }
  }

  implicit object BoolToOption extends Converter[Boolean, Unit] {
    override def convert(a: Boolean): Option[Unit] =
      if (a) Some(()) else None
  }

  implicit object IntArrayToByteArrayConverter extends ArrayConverter[Array[Int], Array[Byte]] {
    def convert(a: Array[Int], bytesPerElement: Int): Array[Byte] =
      a.flatMap { value =>
        (0 until bytesPerElement).map { pos =>
          (value >> (8 * pos)).byteValue
        }
      }
  }

  implicit object ByteArrayToIntArrayConverter extends ArrayConverter[Array[Byte], Array[Int]] {
    def convert(a: Array[Byte], bytesPerElement: Int): Array[Int] =
      a.sliding(bytesPerElement).map(_.foldRight[Int](0)((a, b) => (b << 8) + a)).toArray
  }
}

trait Converter[A, B] {
  def convert(a: A): Option[B]
}

trait ArrayConverter[A, B] {
  def convert(a: A, bytesPerElement: Int): B
}
