package braingames.mvc

import play.api.mvc.{ Controller => PlayController }
import play.api.templates.Html
import play.api.libs.json.Json
import play.api.mvc.SimpleResult
import play.api.libs.json.JsObject
import brainflight.security.AuthenticatedRequest
import brainflight.view.ProvidesSessionData
import play.api.mvc.Request
import net.liftweb.common.{ Box, Full, Empty, Failure, ParamFailure }
import play.api.mvc.Result
import play.api.mvc.Results
import play.api.mvc.ResponseHeader
import play.api.libs.iteratee.Enumerator
import play.api.http._
import scala.concurrent.Future
import play.api.http.Status._
import scala.concurrent.ExecutionContext

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

trait BoxImplicits {
  implicit def option2Box[T](in: Option[T]): Box[T] = Box(in)

  implicit def box2Result[T <: Result](b: Box[T]): Result =
    new ResultBox(b).asResult

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
}

class JsonResult(status: Int) extends SimpleResult[Results.EmptyContent](header = ResponseHeader(status), body = Enumerator(Results.EmptyContent())) with JsonResultAttribues {

  val isSuccess = List(OK) contains status

  def createResult(content: JsObject)(implicit writeable: Writeable[JsObject]) =
    SimpleResult(
      header = ResponseHeader(status, writeable.contentType.map(ct => Map(HeaderNames.CONTENT_TYPE -> ct)).getOrElse(Map.empty)),
      Enumerator(content))

  def apply(html: Html, messages: Seq[(String, String)]) =
    createResult(jsonHTMLResult(html, messages))

  def apply(html: Html, message: String) = {
    if (isSuccess)
      createResult(jsonHTMLResult(html, Seq(jsonSuccess -> message)))
    else
      createResult(jsonHTMLResult(html, Seq(jsonError -> message)))
  }

  def apply(json: JsObject, message: String) =
    createResult(json ++ jsonMessages(Seq(jsonSuccess -> message)))
  
  def apply(message: String): SimpleResult[JsObject] =
    apply(Html.empty, message)

  def jsonHTMLResult(html: Html, messages: Seq[(String, String)]) = {
    val htmlJson = html.body match {
      case "" =>
        Json.obj()
      case body =>
        Json.obj("html" -> body)
    } 
    
    htmlJson ++ jsonMessages(messages)
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

class Controller extends PlayController with ProvidesSessionData with JsonResults with BoxImplicits with Status {

  implicit def AuthenticatedRequest2Request[T](r: AuthenticatedRequest[T]) =
    r.request

  def postParameter(parameter: String)(implicit request: Request[Map[String, Seq[String]]]) =
    request.body.get(parameter).flatMap(_.headOption)

  def postParameterList(parameter: String)(implicit request: Request[Map[String, Seq[String]]]) =
    request.body.get(parameter)
}