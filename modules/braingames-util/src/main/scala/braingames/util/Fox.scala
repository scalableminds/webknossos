package braingames.util

import scala.concurrent.{ExecutionContext, Future}
import net.liftweb.common.{Failure, Empty, Full, Box}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 10.06.13
 * Time: 16:02
 */

trait FoxImplicits {
  implicit def futureBox2Fox[T](f: Future[Box[T]])(implicit ec: ExecutionContext) =
    new Fox(f)

  implicit def box2Fox[T](b: Box[T])(implicit ec: ExecutionContext) =
    new Fox(Future.successful(b))

  implicit def future2Fox[T](f: Future[T])(implicit ec: ExecutionContext) =
    new Fox(f.map(Full(_)))

  implicit def option2Fox[T](b: Option[T])(implicit ec: ExecutionContext) =
    new Fox(Future.successful(Box(b)))

  implicit def futureOption2Fox[T](f: Future[Option[T]])(implicit ec: ExecutionContext) =
    new Fox(f.map(Box(_)))
}


class Fox[+A](val futureBox: Future[Box[A]])(implicit ec: ExecutionContext) {
  val self = this

  def ?~>(s: String) =
    new Fox(futureBox.map(_ ?~ s))

  def ~>[T](errorCode: => T) =
    new Fox(futureBox.map(_ ~> errorCode))

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

  /**
   * Makes Box play better with Scala 2.8 for comprehensions
   */
  def withFilter(p: A => Boolean): WithFilter = new WithFilter(p)

  /**
   * Play NiceLike with the Scala 2.8 for comprehension
   */
  class WithFilter(p: A => Boolean) {
    def map[B](f: A => B): Fox[B] = self.filter(p).map(f)

    def flatMap[B](f: A => Fox[B]): Fox[B] = self.filter(p).flatMap(f)

    def foreach[U](f: A => U): Unit = self.filter(p).foreach(f)

    def withFilter(q: A => Boolean): WithFilter =
      new WithFilter(x => p(x) && q(x))
  }

}