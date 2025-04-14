package com.scalableminds.util.tools

import net.liftweb.common.{Box, Empty, Failure, Full, ParamFailure}
import play.api.libs.json.{JsError, JsResult, JsSuccess}

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.reflect.ClassTag
import scala.util.{Success, Try}

class Ox[+A](futureBox: Future[Box[A]]) {
  def toFox(implicit ec: ExecutionContext) = new Fox(futureBox)
}

trait FoxImplicits {
  implicit protected def box2Ox[T](b: Box[T]): Ox[T] =
    new Ox(Future.successful(b))

  implicit protected def try2Ox[T](t: Try[T]): Ox[T] = t match {
    case Success(result)       => new Ox(Future.successful(Full(result)))
    case scala.util.Failure(e) => new Ox(Future.successful(Failure(e.toString)))
  }

  implicit protected def option2Ox[T](b: Option[T]): Ox[T] =
    new Ox(Future.successful(Box(b)))
}

object Fox extends FoxImplicits {

  def fromBool(b: Boolean)(implicit ec: ExecutionContext): Fox[Unit] =
    if (b) Fox.successful(())
    else Fox.empty

  def fromFutureBox[T](f: Future[Box[T]])(implicit ec: ExecutionContext): Fox[T] =
    new Fox(f)

  /**
    * Transform a Future[T] into a Fox[T] such that if the Future contains an exception, it is turned into a Fox.failure
    */
  def fromFuture[T](f: Future[T])(implicit ec: ExecutionContext): Fox[T] =
    fromFutureBox(
      for {
        fut <- f.transform {
          case Success(value)        => Try(Fox.successful(value))
          case scala.util.Failure(e) => Try(Fox.failure(e.getMessage, Full(e)))
        }
        f <- fut.futureBox
      } yield f
    )

  // TODO unify
  def jsResult2Fox[T](result: JsResult[T])(implicit ec: ExecutionContext): Fox[T] = result match {
    case JsSuccess(value, _) => Fox.successful(value)
    case JsError(e)          => Fox.failure(s"Invalid json: $e")
  }

  def successful[A](e: A)(implicit ec: ExecutionContext): Fox[A] =
    new Fox(Future.successful(Full(e)))

  def empty(implicit ec: ExecutionContext): Fox[Nothing] = new Fox(Future.successful(Empty))

  def failure(message: String, ex: Box[Throwable] = Empty, chain: Box[Failure] = Empty)(
      implicit ec: ExecutionContext): Fox[Nothing] =
    new Fox(Future.successful(Failure(message, ex, chain)))

  def paramFailure[T](message: String, ex: Box[Throwable] = Empty, chain: Box[Failure] = Empty, param: T)(
      implicit ec: ExecutionContext): Fox[Nothing] =
    new Fox(Future.successful(ParamFailure(message, ex, chain, param)))

  // run serially, fail on the first failure
  def serialSequence[A, B](l: List[A])(f: A => Future[B])(implicit ec: ExecutionContext): Future[List[B]] = {
    def runNext(remaining: List[A], results: List[B]): Future[List[B]] =
      remaining match {
        case head :: tail =>
          for {
            currentResult <- f(head)
            results <- runNext(tail, currentResult :: results)
          } yield results
        case Nil =>
          Future.successful(results.reverse)
      }
    runNext(l, Nil)
  }

  // run serially, return individual results in list of box
  def serialSequenceBox[A, B](l: Seq[A])(f: A => Fox[B])(implicit ec: ExecutionContext): Future[List[Box[B]]] = {
    def runNext(remaining: List[A], results: List[Box[B]]): Future[List[Box[B]]] =
      remaining match {
        case head :: tail =>
          for {
            currentResult <- f(head).futureBox
            results <- runNext(tail, currentResult :: results)
          } yield results
        case Nil =>
          Future.successful(results.reverse)
      }
    runNext(l.toList, Nil)
  }

  def sequence[T](l: List[Fox[T]])(implicit ec: ExecutionContext): Future[List[Box[T]]] =
    Future.sequence(l.map(_.futureBox))

  def combined[T](l: Seq[Fox[T]])(implicit ec: ExecutionContext): Fox[List[T]] =
    new Fox(Future.sequence(l.map(_.futureBox)).map { results =>
      results.find(_.isEmpty) match {
        case Some(Empty)            => Empty
        case Some(failure: Failure) => failure
        case _ =>
          Full(
            results.map(_.openOrThrowException("An exception should never be thrown, all boxes must be full")).toList)
      }
    })

  def combined[T](l: Array[Fox[T]])(implicit ec: ExecutionContext,
                                    ev: Array[Future[Box[T]]] => Iterable[Future[Box[T]]],
                                    ct: ClassTag[T]): Fox[Array[T]] = {
    val x = Future.sequence(ev(l.map(_.futureBox)))
    val r: Future[Box[Array[T]]] = x.map { results =>
      results.find(_.isEmpty) match {
        case Some(Empty)            => Empty
        case Some(failure: Failure) => failure
        case _ =>
          val opened = new Array[T](results.size)
          var i = 0
          results.foreach { r =>
            opened(i) = r.openOrThrowException("An exception should never be thrown, all boxes must be full")
            i += 1
          }
          Full(opened)
      }
    }
    new Fox(r)
  }

  // Run serially, fail on the first failure
  def serialCombined[A, B](l: Iterable[A])(f: A => Fox[B])(implicit ec: ExecutionContext): Fox[List[B]] =
    serialCombined(l.iterator)(f)

  // Run serially, fail on the first failure
  def serialCombined[A, B](it: Iterator[A])(f: A => Fox[B])(implicit ec: ExecutionContext): Fox[List[B]] = {
    def runNext(results: List[B]): Fox[List[B]] =
      if (it.hasNext) {
        for {
          currentResult <- f(it.next())
          results <- runNext(currentResult :: results)
        } yield results
      } else {
        Fox.successful(results.reverse)
      }

    runNext(Nil)
  }

  def foldLeft[A, B](l: List[A], initial: B)(f: (B, A) => Fox[B])(implicit ec: ExecutionContext): Fox[List[B]] =
    serialCombined(l.iterator)(a => f(initial, a))

  def foldLeft[A, B](it: Iterator[A], initial: B)(f: (B, A) => Fox[B])(implicit ec: ExecutionContext): Fox[B] = {
    def runNext(collectedResult: B): Fox[B] =
      if (it.hasNext) {
        for {
          currentResult <- f(collectedResult, it.next())
          results <- runNext(currentResult)
        } yield results
      } else {
        Fox.successful(collectedResult)
      }
    runNext(initial)
  }

  // run in sequence, drop everything that isn’t full
  def sequenceOfFulls[T](seq: Seq[Fox[T]])(implicit ec: ExecutionContext): Future[List[T]] =
    Future.sequence(seq.map(_.futureBox)).map { results =>
      results.foldRight(List.empty[T]) {
        case (_: Failure, l) => l
        case (Empty, l)      => l
        case (Full(e), l)    => e :: l
      }
    }

  def filterNot[T](seq: List[T])(f: T => Fox[Boolean])(implicit ec: ExecutionContext): Fox[List[T]] =
    filter(seq, inverted = true)(f)

  def filter[T](seq: List[T], inverted: Boolean = false)(f: T => Fox[Boolean])(
      implicit ec: ExecutionContext): Fox[List[T]] =
    for {
      results <- serialCombined(seq)(f)
      zipped = results.zip(seq)
    } yield zipped.filter(_._1 != inverted).map(_._2)

  def find[T](seq: List[T])(f: T => Fox[Boolean])(implicit ec: ExecutionContext): Fox[T] =
    seq match {
      case head :: tail =>
        for {
          currentResult <- f(head)
          remainingResult <- if (currentResult) Fox.successful(head) else find(tail)(f)
        } yield remainingResult
      case Nil => Fox.empty
    }

  def runOptional[A, B](input: Option[A])(f: A => Fox[B])(implicit ec: ExecutionContext): Fox[Option[B]] =
    input match {
      case Some(i) =>
        for {
          result <- f(i)
        } yield Some(result)
      case None =>
        Fox.successful(None)
    }

  def runIf[B](condition: Boolean)(f: => Fox[B])(implicit ec: ExecutionContext): Fox[Option[B]] =
    if (condition) {
      for {
        result <- f
      } yield Some(result)
    } else {
      Fox.successful(None)
    }

  def runIfOptionTrue[B](condition: Option[Boolean])(f: => Fox[B])(implicit ec: ExecutionContext): Fox[Option[B]] =
    runIf(condition.getOrElse(false))(f)

  def fillOption[A](input: Option[A])(f: => Fox[A])(implicit ec: ExecutionContext): Fox[A] =
    input match {
      case Some(a) => Fox.successful(a)
      case None    => f
    }

  def assertTrue(fox: Fox[Boolean])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      asBoolean <- fox
      _ <- Fox.fromBool(asBoolean)
    } yield ()

  def firstSuccess[T](foxes: Seq[Fox[T]])(implicit ec: ExecutionContext): Fox[T] = {
    def runNext(remainingFoxes: Seq[Fox[T]]): Fox[T] =
      remainingFoxes match {
        case head :: tail =>
          fromFutureBox {
            for {
              resultOption <- head.toFutureOption
              nextResult <- resultOption match {
                case Some(v) => Fox.successful(v).futureBox
                case _       => runNext(tail).futureBox
              }
            } yield nextResult
          }
        case Nil =>
          Fox.empty
      }
    runNext(foxes)
  }

  def assertNoFailure(boxes: Seq[Box[_]])(implicit ec: ExecutionContext): Fox[Unit] = {
    val firstFailure = boxes.find {
      case _: Failure => true
      case _          => false
    }
    firstFailure match {
      case Some(failure) => Fox.failure(s"At least one failure contained in list of ${boxes.length} boxes: $failure")
      case None          => Fox.successful(())
    }
  }

}

class Fox[+A](val futureBox: Future[Box[A]])(implicit ec: ExecutionContext) {
  private val self: Fox[A] = this

  // Add error message in case of Failure and Empty (wrapping Empty in a Failure)
  def ?~>(s: String): Fox[A] =
    new Fox(futureBox.map(_ ?~! s))

  // Add error message only in case of Failure, pass through Empty
  def ?=>(s: String): Fox[A] =
    Fox.fromFutureBox {
      futureBox.map {
        case Full(value) => Full(value)
        case f: Failure  => f ?~! s
        case Empty       => Empty
      }
    }

  // Add http error code in case of Failure or Empty (wrapping Empty in a Failure)
  def ~>[T](errorCode: => T): Fox[A] =
    new Fox(futureBox.map(_ ~> errorCode))

  def orElse[B >: A](fox: => Fox[B]): Fox[B] =
    new Fox(futureBox.flatMap {
      case Full(_) => this.futureBox
      case _       => fox.futureBox
    })

  def getOrElse[B >: A](b: => B): Future[B] =
    futureBox.map(_.getOrElse(b))

  def flatten[B](implicit ev: A <:< Fox[B]): Fox[B] =
    new Fox(futureBox.flatMap {
      case Full(t) =>
        t.futureBox
      case Empty =>
        Future.successful(Empty)
      case fail: Failure =>
        Future.successful(fail)
    })

  def map[B](f: A => B): Fox[B] =
    new Fox(futureBox.map(_.map(f)))

  def flatMap[B](f: A => Fox[B]): Fox[B] =
    new Fox(futureBox.flatMap {
      case Full(t) =>
        f(t).futureBox
      case Empty =>
        Future.successful(Empty)
      case fail: Failure =>
        Future.successful(fail)
    })

  def filter(f: A => Boolean): Fox[A] =
    new Fox(futureBox.map(_.filter(f)))

  def foreach(f: A => _): Unit =
    futureBox.map(_.map(f))

  def toFutureOption: Future[Option[A]] =
    futureBox.map(box => box.toOption)

  def toFutureOrThrowException(justification: String): Future[A] =
    for {
      box: Box[A] <- this.futureBox
    } yield {
      box.openOrThrowException(justification)
    }

  def toFutureWithEmptyToFailure: Future[A] =
    (for {
      box: Box[A] <- this.futureBox
    } yield {
      box match {
        case Full(a)            => Future.successful(a)
        case Failure(msg, _, _) => Future.failed(new Exception(msg))
        case Empty              => Future.failed(new Exception("Empty"))
      }
    }).flatMap(identity)

  /**
    *  Awaits the future and opens the box.
    */
  @deprecated(message = "Do not use this in production code", since = "forever")
  def get(justification: String, awaitTimeout: FiniteDuration = 10 seconds): A = {
    val box = await(justification, awaitTimeout)
    box.openOrThrowException(justification)
  }

  /**
    * Awaits the future and returns the box.
    */
  @deprecated(message = "Do not use this in production code", since = "forever")
  def await(justification: String, awaitTimeout: FiniteDuration = 10 seconds): Box[A] =
    Await.result(futureBox, awaitTimeout)

  /**
    * If the box is Empty this will create a Full. If The box is Full it will get emptied. Failures are passed through.
    */
  def reverse: Fox[Unit] =
    new Fox(futureBox.map {
      case Full(_)    => Empty
      case Empty      => Full(())
      case f: Failure => f
    })

  def fillEmpty[B >: A](fillValue: B) =
    new Fox(futureBox.map {
      case Full(value) => Full(value)
      case Empty       => Full(fillValue)
      case f: Failure  => f
    })

  /**
    * Makes Fox play better with Scala 2.8 for comprehensions
    */
  def withFilter(p: A => Boolean): WithFilter = new WithFilter(p)

  /**
    * Play Nice with the Scala 2.8 for comprehension
    */
  class WithFilter(p: A => Boolean) {
    def map[B](f: A => B): Fox[B] = self.filter(p).map(f)

    def flatMap[B](f: A => Fox[B]): Fox[B] = self.filter(p).flatMap(f)

    def foreach[U](f: A => U): Unit = self.filter(p).foreach(f)

    def withFilter(q: A => Boolean): WithFilter =
      new WithFilter(x => p(x) && q(x))
  }

}
