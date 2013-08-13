package braingames.mvc

import play.api.mvc.{ResponseHeader, SimpleResult, Results, Result}
import net.liftweb.common._
import play.api.http.Status._
import net.liftweb.common.Full
import scala.concurrent.{ExecutionContext, Future}
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{Json, JsObject}
import play.api.http.{HeaderNames, Writeable}
import play.api.templates.Html
import play.api.http.Status

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 13.08.13
 * Time: 14:40
 */
class ResultBox[T <: Result](b: Box[T]) {

  import Results.Status

  def asResult = b match {
    case Full(result) =>
      result
    case ParamFailure(msg, _, _, statusCode: Int) =>
      new JsonResult(statusCode)(msg)
    case Failure(msg, _, _) =>
      new JsonResult(BAD_REQUEST)(msg)
    case Empty =>
      new JsonResult(NOT_FOUND)("Couldn't find the requested ressource.")
  }
}

class Fox[A](val futureBox: Future[Box[A]])(implicit ec: ExecutionContext){
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

trait BoxImplicits {
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

  implicit def option2Box[T](in: Option[T]): Box[T] = Box(in)

  implicit def box2Result[T <: Result](b: Box[T]): Result =
    new ResultBox(b).asResult

  implicit def fox2FutureResult[T <: Result](b: Fox[T])(implicit ec: ExecutionContext): Future[Result] =
    b.futureBox.map( new ResultBox(_).asResult)

  implicit def box2ResultBox[T <: Result](b: Box[T]) = new ResultBox(b)

  implicit def futureBox2Result[T <: Result](b: Box[Future[T]])(implicit ec: ExecutionContext): Future[Result] = {
    b match {
      case Full(f) =>
        f.map(value => new ResultBox(Full(value)).asResult)
      case Empty =>
        Future.successful(new ResultBox(Empty).asResult)
      case f: Failure =>
        Future.successful(new ResultBox(f).asResult)
    }
  }

  implicit def boxFuture2Result[T <: Result](f: Future[Box[T]])(implicit ec: ExecutionContext): Future[Result] = {
    f.map {
      b =>
        new ResultBox(b).asResult
    }
  }
}

object BoxImplicits extends BoxImplicits

class JsonResult(status: Int) extends SimpleResult[Results.EmptyContent](header = ResponseHeader(status), body = Enumerator(Results.EmptyContent())) with JsonResultAttribues {

  val isSuccess = List(OK) contains status

  def createResult(content: JsObject)(implicit writeable: Writeable[JsObject]) =
    SimpleResult(
      header = ResponseHeader(status, writeable.contentType.map(ct => Map(HeaderNames.CONTENT_TYPE -> ct)).getOrElse(Map.empty)),
      Enumerator(content))

  def messageTypeFromStatus =
    if (isSuccess)
      jsonSuccess
    else
      jsonError

  def apply(json: JsObject) =
    createResult(json)

  def apply(json: JsObject, messages: Seq[(String, String)]) =
    createResult(json ++ jsonMessages(messages))

  def apply(html: Html, json: JsObject, messages: Seq[(String, String)]): SimpleResult[JsObject] =
    apply(json ++ jsonHTMLResult(html), messages)

  def apply(html: Html, json: JsObject, message: String): SimpleResult[JsObject] =
    apply(json ++ jsonHTMLResult(html), Seq(messageTypeFromStatus -> message))

  def apply(json: JsObject, message: String): SimpleResult[JsObject] =
    apply(json, Seq(messageTypeFromStatus -> message))

  def apply(html: Html, messages: Seq[(String, String)]): SimpleResult[JsObject] =
    apply(html, Json.obj(), messages)

  def apply(html: Html, message: String): SimpleResult[JsObject] =
    apply(html, Seq(messageTypeFromStatus -> message))

  def apply(message: String): SimpleResult[JsObject] =
    apply(Html.empty, message)

  def jsonHTMLResult(html: Html) = {
    val htmlJson = html.body match {
      case "" =>
        Json.obj()
      case body =>
        Json.obj("html" -> body)
    }

    htmlJson
  }

  def jsonMessages(messages: Seq[(String, String)]) =
    Json.obj(
      "messages" -> messages.map(m => Json.obj(m._1 -> m._2)))
}

trait JsonResults extends JsonResultAttribues {
  val JsonOk = new JsonResult(OK)
  val JsonBadRequest = new JsonResult(BAD_REQUEST)
}

trait JsonResultAttribues {
  val jsonSuccess = "success"
  val jsonError = "error"
}

trait ExtendedController
extends JsonResults
with BoxImplicits
with Status
with withHighlightableResult