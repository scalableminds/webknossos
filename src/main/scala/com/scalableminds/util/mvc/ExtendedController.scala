/*
* Copyright (C) 20011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.mvc

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Full, _}
import play.api.http.Status._
import play.api.http.{HeaderNames, Status, Writeable}
import play.api.i18n.{I18nSupport, Messages}
import play.api.libs.iteratee.Enumerator
import play.api.libs.json._
import play.api.mvc.{Request, ResponseHeader, Result}
import play.twirl.api._

import scala.concurrent.{ExecutionContext, Future}

trait ResultBox extends I18nSupport{

  def asResult[T <: Result](b: Box[T]): Result = b match {
    case Full(result) =>
      result
    case ParamFailure(msg, _, _, statusCode: Int) =>
      new JsonResult(statusCode)(Messages(msg))
    case ParamFailure(msg, _, _, messages: Seq[(String, String)]) =>
      new JsonResult(BAD_REQUEST)(jsonMessages(messages))
    case Failure(msg, _, chain) =>
      new JsonResult(BAD_REQUEST)(Messages(msg), formatChainOpt(chain))
    case Empty =>
      new JsonResult(NOT_FOUND)("Couldn't find the requested resource.")
  }

  private def formatChainOpt(chain: Box[Failure]): Option[String] = chain match {
    case Full(failure) => Some(formatChain(chain))
    case _ => None
  }

  private def formatChain(chain: Box[Failure]): String = chain match {
    case Full(failure) =>
      " <~ " + Messages(failure.msg) + formatChain(failure.chain)
    case _ => ""
  }

  def jsonMessages(messages: Seq[(String, String)]): JsObject =
    Json.obj(
      "messages" -> messages.map(m => Json.obj(m._1 -> m._2)))
}

trait ResultImplicits extends ResultBox with I18nSupport{

  implicit def fox2FutureResult[T <: Result](b: Fox[T])(implicit ec: ExecutionContext): Future[Result] =
    b.futureBox.map(asResult)

  implicit def futureBox2Result[T <: Result](b: Box[Future[T]])(implicit ec: ExecutionContext): Future[Result] = {
    b match {
      case Full(f) =>
        f.map(value => asResult(Full(value)))
      case Empty =>
        Future.successful(asResult(Empty))
      case f: Failure =>
        Future.successful(asResult(f))
    }
  }

  implicit def boxFuture2Result[T <: Result](f: Future[Box[T]])(implicit ec: ExecutionContext): Future[Result] = {
    f.map {
      b =>
        asResult(b)
    }
  }

  implicit def box2Result[T <: Result](b: Box[T]): Result =
    asResult(b)

//  implicit def box2ResultBox[T <: Result](b: Box[T]) = new ResultBox(b)
}

trait BoxImplicits {

  implicit def option2Box[T](in: Option[T]): Box[T] = Box(in)

  implicit def jsResult2Box[T](result: JsResult[T]): Box[T] = result match {
    case JsSuccess(value, _) => Full(value)
    case JsError(e) => Failure(s"Invalid json: $e")
  }
}

object BoxImplicits extends BoxImplicits

class JsonResult(status: Int) extends Result(header = ResponseHeader(status), body = Enumerator(Array[Byte]())) with JsonResultAttribues {

  val isSuccess = List(OK) contains status

  def createResult(content: JsObject)(implicit writeable: Writeable[JsObject]) =
    Result(
      header = ResponseHeader(status, writeable.contentType.map(ct => Map(HeaderNames.CONTENT_TYPE -> ct)).getOrElse(Map.empty)),
      body = Enumerator(writeable.transform(content)))

  def messageTypeFromStatus =
    if (isSuccess)
      jsonSuccess
    else
      jsonError

  def apply(json: JsObject) =
    createResult(json)

  def apply(json: JsObject, messages: Seq[(String, String)]) =
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

  def namedChain(chainOpt: Option[String]) = chainOpt match {
    case None => None
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

trait PostRequestHelpers {
  def postParameter(parameter: String)(implicit request: Request[Map[String, Seq[String]]]) =
    request.body.get(parameter).flatMap(_.headOption)

  def postParameterList(parameter: String)(implicit request: Request[Map[String, Seq[String]]]) =
    request.body.get(parameter)
}

trait ExtendedController
  extends JsonResults
    with BoxImplicits
    with FoxImplicits
    with ResultImplicits
    with Status
    with WithHighlightableResult
    with PostRequestHelpers
    with WithFilters
    with I18nSupport
