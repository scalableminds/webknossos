package com.scalableminds.util.mvc

import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits}
import net.liftweb.common.{Full, _}
import play.api.http.Status._
import play.api.http.{HttpEntity, Status, Writeable}
import play.api.i18n.{I18nSupport, Messages, MessagesProvider}
import play.api.libs.json._
import play.api.mvc.{ResponseHeader, Result}
import play.twirl.api._

import scala.concurrent.{ExecutionContext, Future}

trait ResultBox extends I18nSupport with Formatter {

  def asResult[T <: Result](b: Box[T])(implicit messages: MessagesProvider): Result = b match {
    case Full(result) =>
      result
    case ParamFailure(msg, _, chain, statusCode: Int) =>
      new JsonResult(statusCode)(Messages(msg), formatChainOpt(chain))
    case ParamFailure(_, _, _, msgs: JsArray) =>
      new JsonResult(BAD_REQUEST)(jsonMessages(msgs))
    case Failure(msg, _, chain) =>
      new JsonResult(BAD_REQUEST)(Messages(msg), formatChainOpt(chain))
    case Empty =>
      new JsonResult(NOT_FOUND)("Couldn't find the requested resource.")
  }

  def formatChainOpt(chain: Box[Failure])(implicit messages: MessagesProvider): Option[String] = chain match {
    case Full(_) => Some(formatChain(chain))
    case _       => None
  }

  private def formatChain(chain: Box[Failure], includeTime: Boolean = true)(
      implicit messages: MessagesProvider): String = chain match {
    case Full(failure) =>
      val serverTimeMsg = if (includeTime) "[Server Time " + formatDate(System.currentTimeMillis()) + "] " else ""
      serverTimeMsg + " <~ " + Messages(failure.msg) + formatChain(failure.chain, includeTime = false)
    case _ => ""
  }

  def jsonMessages(msgs: JsArray): JsObject =
    Json.obj("messages" -> msgs)
}

trait ResultImplicits extends ResultBox with I18nSupport {

  implicit def fox2FutureResult[T <: Result](b: Fox[T])(implicit ec: ExecutionContext,
                                                        messages: MessagesProvider): Future[Result] =
    b.futureBox.map(asResult)

  implicit def futureBox2Result[T <: Result](b: Box[Future[T]])(implicit ec: ExecutionContext,
                                                                messages: MessagesProvider): Future[Result] =
    b match {
      case Full(f) =>
        f.map(value => asResult(Full(value)))
      case Empty =>
        Future.successful(asResult(Empty))
      case f: Failure =>
        Future.successful(asResult(f))
    }

  implicit def boxFuture2Result[T <: Result](f: Future[Box[T]])(implicit ec: ExecutionContext,
                                                                messages: MessagesProvider): Future[Result] =
    f.map { b =>
      asResult(b)
    }

  implicit def box2Result[T <: Result](b: Box[T])(implicit messages: MessagesProvider): Result =
    asResult(b)

}

class JsonResult(status: Int)
    extends Result(header = ResponseHeader(status), body = HttpEntity.NoEntity)
    with JsonResultAttribues {

  val isSuccess: Boolean = List(OK) contains status

  def createResult(content: JsObject)(implicit writeable: Writeable[JsObject]): Result =
    Result(header = ResponseHeader(status),
           body = HttpEntity.Strict(writeable.transform(content), writeable.contentType))

  private def messageTypeFromStatus =
    if (isSuccess)
      jsonSuccess
    else
      jsonError

  def apply(json: JsObject): Result =
    createResult(json)

  def apply(json: JsObject, messages: Seq[(String, String)]): Result =
    createResult(json ++ jsonMessages(messages))

  def apply(messages: Seq[(String, String)]): Result =
    apply(Json.obj(), messages)

  def apply(html: Html, json: JsObject, messages: Seq[(String, String)]): Result =
    apply(json ++ jsonHTMLResult(html), messages)

  def apply(html: Html, json: JsObject, message: String): Result =
    apply(json ++ jsonHTMLResult(html), Seq(messageTypeFromStatus -> message))

  def apply(json: JsObject, message: String): Result =
    apply(json, Seq(messageTypeFromStatus -> message))

  def apply(html: Html, messages: Seq[(String, String)]): Result =
    apply(html, Json.obj(), messages)

  def apply(html: Html, message: String, chain: Option[String]): Result =
    apply(html, Seq(messageTypeFromStatus -> message) ++ namedChain(chain))

  def apply(html: Html): Result =
    apply(html, Seq.empty)

  def apply(message: String, chain: Option[String] = None): Result =
    apply(Html(""), message, chain)

  private def namedChain(chainOpt: Option[String]) = chainOpt match {
    case None        => None
    case Some(chain) => Some("chain" -> chain)
  }

  def jsonHTMLResult(html: Html): JsObject = {
    val htmlJson = html.body match {
      case "" =>
        Json.obj()
      case body =>
        Json.obj("html" -> body)
    }

    htmlJson
  }

  def jsonMessages(messages: Seq[(String, String)]): JsObject =
    Json.obj("messages" -> messages.map(m => Json.obj(m._1 -> m._2)))
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
    with FoxImplicits
    with ResultImplicits
    with Status
    with WithHighlightableResult
    with WithFilters
    with I18nSupport
