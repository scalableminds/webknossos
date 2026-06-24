package com.scalableminds.util.box

// Adapted from https://github.com/lift/framework/blob/main/core/common/src/main/scala/net/liftweb/common/Box.scala

/*
 * Copyright 2007-2011 WorldWide Conferencing, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

object Box extends Tryo {

  def combined[A, B](seq: Seq[A])(f: A => Box[B]): Box[Seq[B]] = {
    val boxes = seq.map(f)
    if (boxes.exists(_.isInstanceOf[Failure])) {
      val failureChain =
        boxes.collect { case failure: Failure =>
          failure
        }.reduceRight { (topmostFailure, latestFailure) =>
          topmostFailure.copy(chain = Full(latestFailure))
        }

      ParamFailure(
        failureChain.msg,
        Empty,
        Full(failureChain),
        boxes
      )
    } else {
      Full(boxes.flatten)
    }
  }

  def fromOption[T](in: Option[T]): Box[T] = in match {
    case Some(x) => Full(x)
    case _       => Empty
  }

  def fromTry[T](t: scala.util.Try[T]): Box[T] =
    t.fold(e => Failure(e.getMessage, Full(e), Empty), Full(_))

  def fromBool(in: Boolean): Box[Unit] = if (in) Full(()) else Empty

}

sealed abstract class Box[+A] extends IterableOnce[A] with Product with Serializable {

  def isEmpty: Boolean
  def isDefined: Boolean = !isEmpty
  def get(justification: => String): A
  def getOrElse[B >: A](default: => B): B = default
  def orElse[B >: A](alternative: => Box[B]): Box[B]
  def map[B](f: A => B): Box[B] = Empty
  def flatMap[B](f: A => Box[B]): Box[B] = Empty
  def filter(p: A => Boolean): Box[A] = this
  def filterNot(f: A => Boolean): Box[A] = filter(a => !f(a))
  def exists(func: A => Boolean): Boolean = false
  def contains[B >: A](v: B): Boolean = false
  def forall(func: A => Boolean): Boolean = true
  def foreach[U](f: A => U): Unit = {}
  def toOption: Option[A] = None
  def iterator: Iterator[A] = Iterator.empty
  def toList: List[A] = List.empty

  /** Add error message in case of Failure and Empty (wrapping Empty in a Failure) */
  def ?~>(msg: => String): Box[A] = this

  /** Add http error code in case of Failure or Empty (wrapping Empty in a ParamFailure) */
  def ~>(errorCode: Int): Box[A] = this

  /** Add error message only in case of Failure, pass through Empty */
  def ?->(msg: String): Box[A] = this

  /** Overwrite error message in case of Failure and Empty (wrapping Empty in a Failure). */
  def ??~>(msg: String): Box[A] = this

  override def equals(other: Any): Boolean = (this, other) match {
    case (Full(x), Full(y)) => x == y
    case (Full(x), y)       => x == y
    case (x, y: AnyRef)     => x eq y
    case _                  => false
  }

}

/** Box that contains a value. */
final case class Full[+A](value: A) extends Box[A] {

  def isEmpty: Boolean = false
  def get(justification: => String): A = value
  override def getOrElse[B >: A](default: => B): B = value
  override def orElse[B >: A](alternative: => Box[B]): Box[B] = this
  override def map[B](f: A => B): Box[B] = Full(f(value))
  override def flatMap[B](f: A => Box[B]): Box[B] = f(value)
  override def filter(p: A => Boolean): Box[A] = if (p(value)) this else Empty
  override def exists(func: A => Boolean): Boolean = func(value)
  override def contains[B >: A](v: B): Boolean = value == v
  override def forall(func: A => Boolean): Boolean = func(value)
  override def foreach[U](f: A => U): Unit = f(value)
  override def toOption: Option[A] = Some(value)
  override def iterator: Iterator[A] = Iterator(value)
  override def toList: List[A] = List(value)

}

/** Singleton object representing a completely empty `Box` with no value or failure information.
  */
case object Empty extends EmptyBox

/** An `EmptyBox` is a `Box` containing no value. It can sometimes carry additional failure information, as in
  * `[[Failure]]` and `[[ParamFailure]]`.
  */
sealed abstract class EmptyBox extends Box[Nothing] with Serializable {

  def isEmpty: Boolean = true

  def get(justification: => String): Nothing =
    throw new NullPointerException(s"An Empty Box was opened with justification “$justification”.")

  override def getOrElse[B >: Nothing](default: => B): B = default
  override def orElse[B >: Nothing](alternative: => Box[B]): Box[B] = alternative
  override def filter(p: Nothing => Boolean): Box[Nothing] = this

  override def ?~>(msg: => String): Failure = Failure(msg, Empty, Empty)
  override def ~>(errorCode: Int): ParamFailure[Int] = ParamFailure("", Empty, Empty, errorCode)
  override def ??~>(msg: String): Failure = Failure(msg)

}

/** Companion object used to simplify the creation of a simple `Failure` with just a message.
  */
object Failure {
  def apply(msg: String) = new Failure(msg, Empty, Empty)
}

/** A `Failure` is an `[[EmptyBox]]` with an additional failure message explaining the reason for its being empty. It
  * can also optionally provide an exception and/or a chain of previous `Failure`s that may have caused this one.
  */
sealed case class Failure(msg: String, exception: Box[Throwable], chain: Box[Failure]) extends EmptyBox {

  override def get(justification: => String): Nothing =
    throw new NullPointerException(s"Opened Failure Box (justification: $justification). Details: $this") {
      override def getCause: Throwable = exception `getOrElse` null
    }

  override def map[B](f: Nothing => B): Box[B] = this
  override def flatMap[B](f: Nothing => Box[B]): Box[B] = this

  override def ?~>(msg: => String): Failure = Failure(msg, Empty, Full(this))
  override def ~>(errorCode: Int): ParamFailure[Int] = ParamFailure(msg, exception, chain, errorCode)
  override def ?->(msg: String): Box[Nothing] = ?~>(msg)

  override def equals(other: Any): Boolean = (this, other) match {
    case (Failure(x, y, z), Failure(x1, y1, z1)) => (x, y, z) == (x1, y1, z1)
    case (x, y: AnyRef)                          => x eq y
    case _                                       => false
  }

}

/** Companion object used to simplify the creation of simple `ParamFailure`s, as well as allow pattern-matching on the
  * `ParamFailure`.
  */
object ParamFailure {
  def apply[T](msg: String, exception: Box[Throwable], chain: Box[Failure], param: T) =
    new ParamFailure(msg, exception, chain, param)

  def apply[T](msg: String, param: T) = new ParamFailure(msg, Empty, Empty, param)

  def unapply(in: Box[?]): Option[(String, Box[Throwable], Box[Failure], Any)] = in match {
    case pf: ParamFailure[_] => Some((pf.msg, pf.exception, pf.chain, pf.param))
    case _                   => None
  }
}

/** A `ParamFailure` is a `[[Failure]]` with an additional type-safe parameter that can allow an application to store
  * other information related to the failure.
  */
final class ParamFailure[T](
    override val msg: String,
    override val exception: Box[Throwable],
    override val chain: Box[Failure],
    val param: T
) extends Failure(msg, exception, chain)
    with Serializable {

  override def toString: String =
    f"ParamFailure($msg, $exception, $chain, $param)"

  override def hashCode(): Int =
    super.hashCode() + (param match {
      case null => 0
      case x    => x.hashCode()
    })

  override def ?~>(msg: => String): Failure =
    ParamFailure(msg, Empty, Full(this), this.param)

  override def ~>(errorCode: Int): ParamFailure[Int] =
    ParamFailure(msg, exception, Full(this), errorCode)

  override def equals(that: Any): Boolean = that match {
    case ParamFailure(m, e, c, p) =>
      m == msg && e == exception && c == chain && p == param
    case _ => false
  }
}
