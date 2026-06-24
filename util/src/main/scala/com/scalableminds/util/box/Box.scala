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

  // TODO replace by .toBox as extension on Option?
  def apply[T](in: Option[T]): Box[T] = in match {
    case Some(x) => Full(x)
    case _       => Empty
  }

  // TODO replace by .toBox as extension on Try?
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

  /** Transform an `Empty` to a `Failure` with the specified message. Otherwise returns the same box.
    *
    * @note
    *   This means a `Failure` will also remain unchanged; see `?~!` to change these.
    *
    * @return
    *   A `Failure` with the message if this `Box` is `Empty`, this box otherwise.
    */
  def ?~(msg: => String): Box[A] = this

  /** Transform an `Empty` or `Failure` to a `ParamFailure` with the specified type-safe parameter.
    *
    * @param errorCode
    *   A value indicating the error.
    * @return
    *   A `ParamFailure` with the specified value, unless this is already a `ParamFailure` or a `Full`. If this is a
    *   `Failure`, the `ParamFailure` will preserve the message of the `Failure`.
    */
  def ~>[T](errorCode: => T): Box[A] = this

  /** Alias for `[[?~]]`.
    */
  def failMsg(msg: => String): Box[A] = ?~(msg)

  /** Chain the given `msg` as a `Failure` ahead of any failures this `Box` may represent.
    *
    * If this is an `Empty`, this method behaves like `[[?~]]`. If it is a `Failure`, however, this method returns a new
    * `Failure` with the given `msg` and with its `[[Failure.chain chain]]` set to this `Failure`.
    *
    * As with `[[?~]]`, if this is a `Full`, we return it unchanged.
    *
    * @return
    *   A `Failure` with the message if this `Box` is an `Empty` box. Chain this box to the new `Failure` if this is a
    *   `Failure`. The unchanged box if it is a `Full`.
    */
  def ?~!(msg: => String): Box[A] = ?~(msg)

  /** Alias for `?~!`.
    */
  def compoundFailMsg(msg: => String): Box[A] = ?~!(msg)

  /** If this `Box` contains a value and it satisfies the specified `predicate`, return the `Box` unchanged. Otherwise,
    * return a `Failure` with the given `msg`.
    *
    * @see
    *   [[filter]]
    *
    * @return
    *   A `Failure` with the message if the box is empty or the predicate is not satisfied by the value contained in
    *   this Box.
    */
  def filterMsg(msg: String)(p: A => Boolean): Box[A] = filter(p) ?~ msg

  /** Perform a side effect by passing this `Box` to the specified function and return this `Box` unmodified. Similar to
    * `foreach`, except that `foreach` returns `Unit`, while this method allows chained use of the `Box`.
    *
    * @return
    *   This box.
    */
  def pass(f: Box[A] => Unit): Box[A] = { f(this); this }

  /** Alias for `[[pass]]`.
    */
  def $(f: Box[A] => Unit): Box[A] = pass(f)

  /** For `Full` and `Empty`, this has the expected behavior. Equality in terms of Failure checks for equivalence of
    * failure causes:
    * {{{
    * Failure("boom") == Failure("boom")
    * Failure("bam") != Failure("boom")
    * Failure("boom", Full(someException), Empty) != Failure("boom")
    * }}}
    *
    * For other values, determines equality based upon the contents of this `Box` instead of the box itself. As a
    * result, it is not symmetric. As an example:
    * {{{
    * val foo = "foo"
    * val boxedFoo = Full(foo)
    * foo == boxedFoo //is false
    * boxedFoo == foo //is true
    * }}}
    *
    * It is safest to use `===` explicitly when you're looking for this behavior, and use `==` only for box-to-box
    * comparisons:
    * {{{
    * Full("magic") == Full("magic")
    * Full("magic") != Full("another")
    * Full("magic") != Empty
    * Full("magic") != Failure("something's gone wrong")
    * }}}
    */
  override def equals(other: Any): Boolean = (this, other) match {
    case (Full(x), Full(y)) => x == y
    case (Full(x), y)       => x == y
    case (x, y: AnyRef)     => x eq y
    case _                  => false
  }

  /** Equivalent to `flatMap(f1).or(alternative)`.
    */
  def choice[B](f1: A => Box[B])(alternative: => Box[B]): Box[B] = this match {
    case Full(x) => f1(x)
    case _       => alternative
  }

  /** Equivalent to `map(f).getOr(dflt)`.
    */
  def dmap[B](dflt: => B)(f: A => B): B = dflt

  /** If the `Box` is `Full`, apply the transform function `f` on the value `v`; otherwise, just return the value
    * untransformed.
    *
    * The transform function is expected to be a function that will take the value `v` and produce a function from the
    * value in the box to a new value of the same type as `v`.
    *
    * For example:
    * {{{
    * val myBox = Full(10)
    * myBox.fullXForm("No teddy bears left.")({ message =>
    *   { teddyBears: Int =>
    *     s"\$message Oh wait, there are \$teddyBears left!"
    *   }
    * })
    * }}}
    *
    * @tparam T
    *   The type of the initial value, default value, and transformed value.
    * @return
    *   If the `Box` is `Full`, the value once transformed by the function returned by `f`. Otherwise, the initial value
    *   `v`.
    */
  def fullXform[T](v: T)(f: T => A => T): T = v

  /** An `[[scala.util.Either Either]]` that is a `Left` with the given argument `left` if this is empty, or a `Right`
    * with the boxed value if this is `Full`.
    */
  def toRight[B](left: => B): Either[B, A] = Left(left)

  /** An `[[scala.util.Either Either]]` that is a `Right` with the given argument `right` if this is empty, or a `Left`
    * with the boxed value if this is `Full`.
    */
  def toLeft[B](right: => B): Either[A, B] = Right(right)

  /** Transforms this box using the `transformFn`. If `transformFn` is defined for this box, returns the result of
    * applying `transformFn` to it. Otherwise, returns this box unchanged.
    *
    * If you want to change the content of a `Full` box, using `[[map]]` or `[[collect]]` might be better suited to that
    * purpose. If you want to convert an `Empty`, `Failure` or a `ParamFailure` into a `Full` box, you should use
    * `[[flip]]`.
    *
    * @example
    *   {{{
    *
    * // Returns Full("alternative") because the partial function covers the case. Full("error") transform { case
    * Full("error") => Full("alternative") }
    *
    * // Returns Full(1), this Full box unchanged, because the partial function doesn't cover the case. Full(1)
    * transform { case Full(2) => Failure("error") }
    *
    * // Returns this Failure("another-error") unchanged because the partial function doesn't cover the case.
    * Failure("another-error") transform { case Failure("error", Empty, Empty) => Full("alternative") }
    *
    * // Returns Full("alternative") for an Empty box since `partialFn` is defined for Empty Empty transform { case
    * Empty => Full("alternative") }
    *
    * // Returns Empty because the partial function is not defined for Empty Empty transform { case Failure("error",
    * Empty, Empty) => Full("alternative") }
    *
    *   }}}
    */
  def transform[B >: A](transformFn: PartialFunction[Box[A], Box[B]]): Box[B] =
    transformFn.applyOrElse(this, (thisBox: Box[A]) => thisBox)

  /** Returns a `Full` box containing the results of applying `flipFn` to this box if it is a `Failure`, `ParamFailure`
    * or `Empty`. Returns `Empty` if this box is `Full`. In other words, it "flips" the full/empty status of this Box.
    */
  def flip[B](flipFn: EmptyBox => B): Box[B] = this match {
    case e: EmptyBox => Full(flipFn(e))
    case _           => Empty
  }
}

/** `Full` is a `[[Box]]` that contains a value.
  */
final case class Full[+A](value: A) extends Box[A] {
  def isEmpty: Boolean = false

  def get(justification: => String): A = value

  override def getOrElse[B >: A](default: => B): B = value

  override def orElse[B >: A](alternative: => Box[B]): Box[B] = this

  override def exists(func: A => Boolean): Boolean = func(value)

  override def forall(func: A => Boolean): Boolean = func(value)

  override def filter(p: A => Boolean): Box[A] = if (p(value)) this else Empty

  override def foreach[U](f: A => U): Unit = f(value)

  override def map[B](f: A => B): Box[B] = Full(f(value))

  override def flatMap[B](f: A => Box[B]): Box[B] = f(value)

  override def iterator: Iterator[A] = Iterator(value)

  override def toList: List[A] = List(value)

  override def toOption: Option[A] = Some(value)

  override def fullXform[T](v: T)(f: T => A => T): T = f(v)(value)

  override def toRight[B](left: => B): Either[B, A] = Right(value)

  override def toLeft[B](right: => B): Either[A, B] = Left(value)

  override def contains[B >: A](v: B): Boolean = value == v

  override def dmap[B](dflt: => B)(f: A => B): B = f(value)
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
    throw new NullPointerException(
      "An Empty Box was opened.  The justification for allowing the getOrThrow was " + justification
    )

  override def getOrElse[B >: Nothing](default: => B): B = default

  override def orElse[B >: Nothing](alternative: => Box[B]): Box[B] = alternative

  override def filter(p: Nothing => Boolean): Box[Nothing] = this

  override def ?~(msg: => String): Failure = Failure(msg, Empty, Empty)

  override def ?~!(msg: => String): Failure = Failure(msg, Empty, Empty)

  override def ~>[T](errorCode: => T): ParamFailure[T] = ParamFailure("", Empty, Empty, errorCode)
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
  type A = Nothing

  override def get(justification: => String): Nothing =
    throw new NullPointerException(s"Opened Failure Box (justification: $justification). Details: $this") {
      override def getCause: Throwable = exception `getOrElse` null
    }

  override def map[B](f: A => B): Box[B] = this

  override def flatMap[B](f: A => Box[B]): Box[B] = this

  private def chainList: List[Failure] = chain match {
    case Full(f) => f :: f.chainList
    case _       => Nil
  }

  /** Return a list of the exceptions that led to this `Failure`. First, unflattens the list of causes of this
    * `Failure`'s `exception`. Then, if this `Failure` has a `chain`, walks down it and concatenates their
    * `exceptionChain` to the end of this one's.
    *
    * @return
    *   A single list of `Throwable`s from the most direct cause to the least direct cause of this `Failure`.
    */
  def exceptionChain: List[Throwable] = {
    import scala.collection.mutable.ListBuffer
    val ret = new ListBuffer[Throwable]()
    var e: Throwable = exception `getOrElse` null

    while (e ne null) {
      ret += e
      e = e.getCause
    }

    ret ++= chain.toList.flatMap(_.exceptionChain)
    ret.toList
  }

  /** Gets the deepest exception cause, if any, which is ostensibly the root cause of this `Failure`.
    */
  def rootExceptionCause: Box[Throwable] =
    Box(exceptionChain.lastOption)

  /** Flatten the `Failure` chain to a List where this Failure is at the head.
    */
  def failureChain: List[Failure] =
    this :: chain.toList.flatMap(_.failureChain)

  /** Reduce this `Failure`'s message and the messages of all chained failures a to a single `String`. The resulting
    * string links each step in the failure chain with <-, and this `Failure`'s message is last.
    *
    * For example:
    * {{{
    * scala> Failure("It's all gone wrong.") ?~! "Something's gone wrong." ?~! "It's all sideways"
    * res0: com.scalableminds.util.tools.Failure = Failure(It's all sideways,Empty,
    *         Full(Failure(Something's gone wrong.,Empty,
    *           Full(Failure(It's all gone wrong.,Empty,Empty)))))
    * scala> res0.messageChain
    * res1: String = It's all sideways <- Something's gone wrong. <- It's all gone wrong.
    * }}}
    */
  def messageChain: String = (this :: chainList).map(_.msg).mkString(" <- ")

  override def equals(other: Any): Boolean = (this, other) match {
    case (Failure(x, y, z), Failure(x1, y1, z1)) => (x, y, z) == (x1, y1, z1)
    case (x, y: AnyRef)                          => x eq y
    case _                                       => false
  }

  override def ?~(msg: => String): Failure = this

  override def ?~!(msg: => String): Failure = Failure(msg, Empty, Full(this))

  override def ~>[T](errorCode: => T): ParamFailure[T] = ParamFailure(msg, exception, chain, errorCode)
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
  *
  * For example:
  * {{{
  * val loggedInUser =
  *   for {
  *     username ?~ "Missing username" ~> "error.missingUser"
  *     password ?~! "Missing password" ~> "error.missingPassword"
  *     user <- User.find("username" -> username)
  *     if User.checkPassword(password, user.password)
  *   } yield {
  *     user
  *   }
  *
  * loggedInUser match {
  *   case ParamFailure(message, _, _, i18nKey: String) =>
  *     tellUser(i18n(i18nKey))
  *   case Failure(message, _, _) =>
  *     tellUser(failureMessage)
  *   case Empty =>
  *     tellUser("Unknown login failure.")
  *   case _ =>
  *     tellUser("You're in!")
  * }
  * }}}
  */
final class ParamFailure[T](
    override val msg: String,
    override val exception: Box[Throwable],
    override val chain: Box[Failure],
    val param: T
) extends Failure(msg, exception, chain)
    with Serializable {
  override def toString: String =
    "ParamFailure(" + msg + ", " + exception +
      ", " + chain + ", " + param + ")"

  override def equals(that: Any): Boolean = that match {
    case ParamFailure(m, e, c, p) =>
      m == msg && e == exception && c == chain && p == param
    case _ => false
  }

  override def hashCode(): Int =
    super.hashCode() + (param match {
      case null => 0
      case x    => x.hashCode()
    })

  override def ~>[T](errorCode: => T): ParamFailure[T] =
    ParamFailure("hello!", exception, Full(this), errorCode)

  override def ?~!(msg: => String): Failure = ParamFailure(msg, Empty, Full(this), this.param)
}
