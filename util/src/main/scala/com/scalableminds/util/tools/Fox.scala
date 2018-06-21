/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.json.{JsError, JsResult, JsSuccess}

import scala.concurrent.{ExecutionContext, Future}
import scala.reflect.ClassTag

trait FoxImplicits {
  implicit def bool2Fox(b: Boolean)(implicit ec: ExecutionContext): Fox[Boolean] =
    if(b) Fox.successful(b)
    else  Fox.empty

  implicit def futureBox2Fox[T](f: Future[Box[T]])(implicit ec: ExecutionContext): Fox[T] =
    new Fox(f)

  implicit def futureFull2Fox[T](f: Future[Full[T]])(implicit ec: ExecutionContext): Fox[T] =
    new Fox(f)

  implicit def box2Fox[T](b: Box[T])(implicit ec: ExecutionContext): Fox[T] =
    new Fox(Future.successful(b))

  implicit def future2Fox[T](f: Future[T])(implicit ec: ExecutionContext): Fox[T] =
    new Fox(f.map(Full(_)))

  implicit def option2Fox[T](b: Option[T])(implicit ec: ExecutionContext): Fox[T] =
    new Fox(Future.successful(Box(b)))

  implicit def futureOption2Fox[T](f: Future[Option[T]])(implicit ec: ExecutionContext): Fox[T] =
    new Fox(f.map(Box(_)))

  implicit def jsResult2Fox[T](result: JsResult[T])(implicit ec: ExecutionContext): Fox[T] = result match {
    case JsSuccess(value, _) => Fox.successful(value)
    case JsError(e) => Fox.failure(s"Invalid json: $e")
  }

  implicit def fox2FutureBox[T](f: Fox[T])(implicit ec: ExecutionContext): Future[Box[T]] =
    f.futureBox
}

object Fox{
  def apply[A](future: Future[Box[A]])(implicit ec: ExecutionContext): Fox[A]  =
    new Fox(future)

  def successful[A](e: A)(implicit ec: ExecutionContext): Fox[A]  =
    new Fox(Future.successful(Full(e)))

  def empty(implicit ec: ExecutionContext): Fox[Nothing] = new Fox(Future.successful(Empty))

  def failure(message: String, ex: Box[Throwable] = Empty,
              chain: Box[Failure] = Empty)(implicit ec: ExecutionContext): Fox[Nothing]  =
    new Fox(Future.successful(Failure(message, ex, chain)))

  def serialSequence[A, B](l: List[A])(f: A => Future[B])(implicit ec: ExecutionContext): Future[List[B]] = {
    def runNext(remaining: List[A], results: List[B]): Future[List[B]] = {
      remaining match {
        case head :: tail =>
          for{
            currentResult <- f(head)
            results <- runNext(tail, currentResult :: results)
          } yield results
        case Nil =>
          Future.successful(results.reverse)
      }
    }
    runNext(l, Nil)
  }

  def sequence[T](l: List[Fox[T]])(implicit ec: ExecutionContext): Future[List[Box[T]]] =
    Future.sequence(l.map(_.futureBox))

  def combined[T](l: List[Fox[T]])(implicit ec: ExecutionContext): Fox[List[T]] = {
    Fox(
      Future.sequence(l.map(_.futureBox)).map { results =>
        results.find(_.isEmpty) match {
          case Some(Empty) => Empty
          case Some(failure: Failure) => failure
          case _ => Full(results.map(_.openOrThrowException("An exception should never be thrown, all boxes must be full")))
        }
      })
  }

  def combined[T](l: Array[Fox[T]])(implicit ec: ExecutionContext, ev: Array[Future[Box[T]]] => Traversable[Future[Box[T]]], ct: ClassTag[T]): Fox[Array[T]] = {
    val x = Future.sequence(ev(l.map(_.futureBox)))
    val r: Future[Box[Array[T]]] = x.map{ results =>
     results.find(_.isEmpty) match {
       case Some(Empty) => Empty
       case Some(failure : Failure) => failure
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

  def serialCombined[A, B](l: List[A])(f: A => Fox[B])(implicit ec: ExecutionContext): Fox[List[B]] = {
    def runNext(remaining: List[A], results: List[B]): Fox[List[B]] = {
      remaining match {
        case head :: tail =>
          for{
            currentResult <- f(head)
            results <- runNext(tail, currentResult :: results)
          } yield results
        case Nil =>
          Fox.successful(results.reverse)
      }
    }
    runNext(l, Nil)
  }

  def sequenceOfFulls[T](seq: List[Fox[T]])(implicit ec: ExecutionContext): Future[List[T]] =
    Future.sequence(seq.map(_.futureBox)).map{ results =>
      results.foldRight(List.empty[T]){
        case (_ : Failure, l) => l
        case (Empty, l) => l
        case (Full(e), l) => e :: l
      }
    }

  def filterNot[T](seq: List[T])(f: T => Fox[Boolean])(implicit ec: ExecutionContext) =
    filter(seq, inverted= true)(f)

  def filter[T](seq: List[T], inverted: Boolean = false)(f: T => Fox[Boolean])(implicit ec: ExecutionContext) = {
    for {
      results <- serialCombined(seq)(f)
      zipped = results.zip(seq)
    } yield (zipped.filter(_._1 != inverted).map(_._2))
  }

  def runOptional[A, B](input: Option[A])(f: A => Fox[B])(implicit ec: ExecutionContext) = {
    input match {
      case Some(i) =>
        for {
          result <- f(i)
        } yield Some(result)
      case None =>
        Fox.successful(None)}
  }

}

class Fox[+A](val futureBox: Future[Box[A]])(implicit ec: ExecutionContext) {
  val self = this

  def ?~>(s: String): Fox[A] =
    new Fox(futureBox.map(_ ?~! s))

  def ~>[T](errorCode: => T): Fox[A] =
    new Fox(futureBox.map(_ ~> errorCode))

  def orElse[B >: A](fox: => Fox[B]): Fox[B] =
    new Fox(futureBox.flatMap{
      case Full(t) => this.futureBox
      case _ => fox.futureBox
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

  def filter(f: A => Boolean): Fox[A] = {
    new Fox(futureBox.map(_.filter(f)))
  }

  def foreach(f: A => _): Unit = {
    futureBox.map(_.map(f))
  }

  def toFutureOption: Future[Option[A]] = {
    futureBox.map(box => box.toOption)
  }

  def toFutureOrThrowException(justification: String): Future[A] = {
    for {
      box: Box[A] <- this.futureBox
    } yield {
      box.openOrThrowException(justification)
    }
  }

  /**
   * Helper to force an implicit conversation
   */
  def toFox: Fox[A] = this

  /**
   * If the box is Empty this will create a Full. If The box is Full it will get emptied. Failures are passed through.
   */
  def reverse: Fox[Boolean] = {
    new Fox(futureBox.map{
      case Full(_) => Empty
      case Empty => Full(true)
      case f: Failure => f
    })
  }


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
