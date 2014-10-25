/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.tools

import java.nio.ByteBuffer
import play.api.libs.ws.{WSAuthScheme, WSRequestHolder}

import scala.math._
import scala.reflect.ClassTag
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits._
import scala.collection.immutable.Queue
import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.Math._

object ExtendedTypes {

  implicit class ExtendedList[A](val list: List[A]) extends AnyVal {
    def futureSort[B](f: A => Future[B])(implicit ord: Ordering[B]) = {
      Future.traverse(list) {
        e =>
          f(e).map(_ -> e)
      }.map(_.sortBy(_._1).map(_._2))
    }
  }

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

  implicit class ExtendedArraySeq[T](val as: Seq[Array[T]]) {
    def appendArrays(implicit c: ClassTag[T]) = {
      if (as.size == 1)
        as(0)
      else {
        val size = as.map(_.size).sum
        val combined = new Array[T](size)
        as.foldLeft(0) {
          case (idx, a) =>
            Array.copy(a, 0, combined, idx, a.length)
            idx + a.length
        }
        combined
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
      case _ => false
    }

    /**
     * Splits this collection into smaller sub-arrays each containing exactly
     * subCollectionSize entries (except the last sub-array which may contain less)
     */
    def subDivide(subCollectionSize: Int): Array[Array[Byte]] =
      b.sliding(subCollectionSize, subCollectionSize).toArray
  }

  implicit class ExtendedDouble(val d: Double) extends AnyVal {


    /**
     * Patches the value of this double (used during arithmetic operations
     * which may result in slightly incorrect result. To ensure correct
     * rounding an epsilon is added/subtracted)
     */
    def patchAbsoluteValue =
      if (d >= 0)
        d + EPSILON
      else
        d - EPSILON

    /**
     * Tests if the value is near zero
     */
    def isNearZero =
      d <= EPSILON && d >= -EPSILON

    def castToInt =
      (d + EPSILON).toInt

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

    def toFloatOpt = StringToFloat.convert(s)

    def toIntOpt = StringToInt.convert(s)

    def toLongOpt = StringToLong.convert(s)

    def toBooleanOpt = StringToBoolean.convert(s)
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

  implicit class ExtendedBooleanFuture(future: Future[Boolean]) {
    def failIfFalse(errorMsg: String) = {
      future.map {
        case true => Full(true)
        case false => Failure(errorMsg)
      }
    }

    def failIfTrue(errorMsg: String) = {
      future.map {
        case false => Full(false)
        case true => Failure(errorMsg)
      }
    }
  }

  implicit class ExtendedBoolean(val b: Boolean) extends AnyVal {
    def failIfFalse(errorMsg: String) = b match {
      case true => Full(true)
      case false => Failure(errorMsg)
    }

    def failIfTrue(errorMsg: String) = b match {
      case false => Full(false)
      case true => Failure(errorMsg)
    }
  }

  case class Auth(isEnabled: Boolean, username: String = "", password: String = "")

  implicit class ExtendedWSRequestHolder(r: WSRequestHolder) {
    def withAuth(a: Auth): WSRequestHolder = {
      if (a.isEnabled)
        r.withAuth(a.username, a.password, WSAuthScheme.BASIC)
      else
        r
    }
  }

  implicit class CappedQueue[A](q: Queue[A]) {
    def enqueueCapped[B >: A](elem: B, maxSize: Int): Queue[B] = {
      var ret = q.enqueue(elem)
      while (ret.size > maxSize) { ret = ret.dequeue._2 }
      ret
    }
  }

}