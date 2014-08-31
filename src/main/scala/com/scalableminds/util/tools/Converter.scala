/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

object DefaultConverters{
  implicit object StringToBoolean extends Converter[String, Boolean]{
    def convert(s: String) = try {
      Some(s.toBoolean)
    } catch {
      case _: java.lang.IllegalArgumentException => None
    }
  }

  implicit object StringToInt extends Converter[String, Int]{
    def convert(s: String) = try {
      Some(s.toInt)
    } catch {
      case _: java.lang.NumberFormatException => None
    }
  }

  implicit object StringToFloat extends Converter[String, Float]{
    def convert(s: String) = try {
      Some(s.toFloat)
    } catch {
      case _: java.lang.NumberFormatException => None
    }
  }

  implicit object StringToLong extends Converter[String, Long]{
    def convert(s: String) = try {
      Some(s.toLong)
    } catch {
      case _: java.lang.NumberFormatException => None
    }
  }

  implicit object IntArrayToByteArrayConverter extends ArrayConverter[Array[Int], Array[Byte]]{
    def convert(a: Array[Int], bytesPerElement: Int) = {
      a.map{
        value =>
          (0 until bytesPerElement).map{
            pos =>
              (value >> (8 * pos)).byteValue 
          }
      }.flatten
    }
  }

  implicit object ByteArrayToIntArrayConverter extends ArrayConverter[Array[Byte], Array[Int]]{
    def convert(a: Array[Byte], bytesPerElement: Int) = {
      a.sliding(bytesPerElement).map(_.foldRight[Int](0)((a, b) => (b << 8) + a)).toArray
    }
  }
}


trait Converter[A, B]{
  def convert(a: A): Option[B]
}

trait ArrayConverter[A, B]{
  def convert(a: A, bytesPerElement: Int): B
}
