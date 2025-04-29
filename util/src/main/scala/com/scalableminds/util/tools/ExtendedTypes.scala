package com.scalableminds.util.tools

import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.Math._
import scala.reflect.ClassTag

object ExtendedTypes {

  implicit class ExtendedArraySeq[T](val as: Seq[Array[T]]) {
    def appendArrays(implicit c: ClassTag[T]): Array[T] =
      if (as.size == 1)
        as.head
      else {
        val size = as.map(_.length).sum
        val combined = new Array[T](size)
        var idx = 0
        var i = 0
        while (i < as.length) {
          Array.copy(as(i), 0, combined, idx, as(i).length)
          idx += as(i).length
          i += 1
        }
        combined
      }
  }

  implicit class ExtendedDouble(val d: Double) extends AnyVal {

    /**
      * Tests if the value is near zero
      */
    def isNearZero: Boolean =
      d <= EPSILON && d >= -EPSILON

    /**
      * Makes sure the double is in the given interval.
      */
    def clamp(low: Double, high: Double): Double =
      math.min(high, math.max(low, d))

  }

  implicit class ExtendedString(val s: String) extends AnyVal {

    def toFloatOpt: Option[Float] = StringToFloat.convert(s)

    def toDoubleOpt: Option[Double] = StringToDouble.convert(s)

    def toIntOpt: Option[Int] = StringToInt.convert(s)

    def toLongOpt: Option[Long] = StringToLong.convert(s)

    def toBooleanOpt: Option[Boolean] = StringToBoolean.convert(s)
  }

}
