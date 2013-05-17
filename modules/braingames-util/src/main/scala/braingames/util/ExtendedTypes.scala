package braingames.util

import java.nio.ByteBuffer
import scala.math._

object ExtendedTypes {

  implicit class ExtendedArray[A](val array: Array[A]) extends AnyVal {

    /**
     * A dynamic sliding window is a sliding window which is moved n steps
     * according to the return value of the passed function.
     */
    def dynamicSliding(windowSize: Int)(f: List[A] => Int) {
      val iterator = array.sliding(windowSize, 1)
      while (iterator.hasNext) {
        val steps = f(iterator.next().toList)
        iterator.drop(steps)
      }
    }
  }

  implicit class When[F](fun: F) {
    def when(cond: F => Boolean)(tail: F => F) =
      if (cond(fun)) tail(fun) else fun
  }

  implicit class ExtendedByteArray(val b: Array[Byte]) extends AnyVal {
    /**
     * Converts this array of bytes to one float value
     */
    def toFloat = {
      if (b != null && b.size == 4)
        ByteBuffer.wrap(b).getFloat
      else
        Float.NaN
    }

    /**
     * Converts this array of bytes to one int value
     */
    def toIntFromFloat = toFloat.toInt

    def toBooleanFromFloat = b match {
      case Array(0x3F, -0x80, 0x0, 0x0) => true
      case _                            => false
    }

    /**
     * Splits this collection into smaller sub-arrays each containing exactly
     * subCollectionSize entries (except the last sub-array which may contain less)
     */
    def subDivide(subCollectionSize: Int): Array[Array[Byte]] =
      b.sliding(subCollectionSize, subCollectionSize).toArray
  }

  implicit class ExtendedDouble(val d: Double) extends AnyVal {
    import braingames.util.Math._
    /**
     * Patches the value of this double (used during arithmetic operations
     * which may result in slightly incorrect result. To ensure correct
     * rounding an epsilon is added/subtracted)
     */
    def patchAbsoluteValue =
      if (d >= 0)
        d + Math.EPSILON
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
      val binary = new Array[Byte](8)
      ByteBuffer.wrap(binary).putDouble(d)
      binary
    }
  }

  implicit class ExtendedFloat(val f: Float) extends AnyVal {
    /**
     * Converts this float into an array of bytes
     */
    def toBinary = {
      val binary = new Array[Byte](4)
      ByteBuffer.wrap(binary).putFloat(f)
      binary
    }
  }

  implicit class ExtendedInt(val i: Int) extends AnyVal {
    /**
     * Converts this int into an array of bytes
     */
    def toBinary = {
      val binary = new Array[Byte](4)
      ByteBuffer.wrap(binary).putInt(i)
      binary
    }
  }

  implicit class ExtendedString(val s: String) extends AnyVal {

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

  import net.liftweb.common._
  import scala.concurrent.Future

  implicit class ExtendedFutureBox[T](b: Box[Future[Box[T]]]) {
    def flatten: Future[Box[T]] = {
      b match {
        case Full(f) =>
          f
        case Empty =>
          Future.successful(Empty)
        case f: Failure =>
          Future.successful(f)
      }
    }
  }
}