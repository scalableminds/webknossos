package com.scalableminds.util.tools

import java.io.RandomAccessFile
import java.nio.ByteBuffer

import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.Math._
import com.scalableminds.util.tools.{Box, Failure}

import scala.collection.immutable.Queue
import scala.concurrent.ExecutionContext.Implicits._
import scala.concurrent.Future
import scala.math._
import scala.reflect.ClassTag

object ExtendedTypes {

  implicit class ExtendedBox[A](val box: Box[A]) extends AnyVal {
    def passFailure(f: Failure => Unit): Box[A] =
      box.pass {
        case failure: Failure => f(failure)
        case _                => ()
      }
  }

  implicit class ExtendedList[A](val list: List[A]) extends AnyVal {
    def futureSort[B](f: A => Future[B])(implicit ord: Ordering[B]): Future[List[A]] =
      Future
        .traverse(list) { e =>
          f(e).map(_ -> e)
        }
        .map(_.sortBy(_._1).map(_._2))
  }

  implicit class ExtendedArray[A](val array: Array[A]) extends AnyVal {

    /** A dynamic sliding window is a sliding window which is moved n steps according to the return value of the passed
      * function.
      */
    def dynamicSliding(windowSize: Int)(f: List[A] => Int): Unit = {
      val iterator = array.sliding(windowSize, 1)
      while (iterator.hasNext) {
        val steps = f(iterator.next().toList)
        iterator.drop(steps)
      }
    }
  }

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

  implicit class When[F](fun: F) {
    def when(cond: F => Boolean)(tail: F => F): F =
      if (cond(fun)) tail(fun) else fun
  }

  implicit class ExtendedByteArray(val b: Array[Byte]) extends AnyVal {

    /** Converts this array of bytes to one float value
      */
    def toFloat: Float =
      if (b != null && b.length == 4)
        ByteBuffer.wrap(b).getFloat
      else
        Float.NaN

    /** Converts this array of bytes to one int value
      */
    def toIntFromFloat: Int = toFloat.toInt

    def toBooleanFromFloat: Boolean = b match {
      case Array(0x3f, -0x80, 0x0, 0x0) => true
      case _                            => false
    }

    /** Splits this collection into smaller sub-arrays each containing exactly subCollectionSize entries (except the
      * last sub-array which may contain less)
      */
    def subDivide(subCollectionSize: Int): Array[Array[Byte]] =
      b.sliding(subCollectionSize, subCollectionSize).toArray
  }

  implicit class ExtendedDouble(val d: Double) extends AnyVal {

    /** Patches the value of this double (used during arithmetic operations which may result in slightly incorrect
      * result. To ensure correct rounding an epsilon is added/subtracted)
      */
    def patchAbsoluteValue: Double =
      if (d >= 0)
        d + EPSILON
      else
        d - EPSILON

    /** Tests if the value is near zero
      */
    def isNearZero: Boolean =
      d <= EPSILON && d >= -EPSILON

    def castToInt: Int =
      (d + EPSILON).toInt

    /** Makes sure the double is in the given interval.
      */
    def clamp(low: Double, high: Double): Double =
      math.min(high, math.max(low, d))

    /** Converts this double into an array of bytes
      */
    def toBinary: Array[Byte] = {
      val binary = new Array[Byte](8)
      ByteBuffer.wrap(binary).putDouble(d)
      binary
    }
  }

  implicit class ExtendedFloat(val f: Float) extends AnyVal {

    /** Converts this float into an array of bytes
      */
    def toBinary: Array[Byte] = {
      val binary = new Array[Byte](4)
      ByteBuffer.wrap(binary).putFloat(f)
      binary
    }
  }

  implicit class ExtendedInt(val i: Int) extends AnyVal {

    /** Converts this int into an array of bytes
      */
    def toBinary: Array[Byte] = {
      val binary = new Array[Byte](4)
      ByteBuffer.wrap(binary).putInt(i)
      binary
    }
  }

  implicit class ExtendedString(val s: String) extends AnyVal {

    def toFloatOpt: Option[Float] = StringToFloat.convert(s)

    def toDoubleOpt: Option[Double] = StringToDouble.convert(s)

    def toIntOpt: Option[Int] = StringToInt.convert(s)

    def toLongOpt: Option[Long] = StringToLong.convert(s)

    def toBooleanOpt: Option[Boolean] = StringToBoolean.convert(s)
  }

  import com.scalableminds.util.tools._

  import scala.concurrent.Future

  implicit class ExtendedFutureBox[T](b: Box[Future[Box[T]]]) {
    def flatten: Future[Box[T]] =
      b match {
        case Full(f) =>
          f
        case Empty =>
          Future.successful(Empty)
        case f: Failure =>
          Future.successful(f)
      }
  }

  implicit class CappedQueue[A](q: Queue[A]) {
    def enqueueCapped[B >: A](elem: B, maxSize: Int): Queue[B] = {
      var ret = q.enqueue(elem)
      while (ret.size > maxSize)
        ret = ret.dequeue._2
      ret
    }
  }

  implicit class ExtendedRandomAccessFile(f: RandomAccessFile) {
    def isClosed: Boolean = {
      val method = f.getClass.getDeclaredField("closed")
      method.setAccessible(true)
      method.getBoolean(f)
    }

    def getPath: String = {
      val method2 = f.getClass.getDeclaredField("path")
      method2.setAccessible(true)
      method2.get(f).asInstanceOf[String]
    }
  }

  implicit class ExtendedListOfBoxes[T](l: List[Box[T]]) {
    def combine: Box[List[T]] =
      l.foldLeft[Box[List[T]]](Full(List.empty)) { (result: Box[List[T]], elemBox: Box[T]) =>
        result.flatMap { l2 =>
          elemBox match {
            case Full(elem) =>
              Full(l2 :+ elem)
            case Empty =>
              Full(l2)
            case f: Failure =>
              f
          }
        }
      }
  }

}
