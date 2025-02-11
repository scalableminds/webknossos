package com.scalableminds.util.mvc

import com.google.protobuf.CodedInputStream
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.requestlogging.RequestLogging
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools._
import com.scalableminds.util.tools.Box.tryo
import play.api.http.Status._
import play.api.http.{HeaderNames, HttpEntity, Status, Writeable}
import play.api.i18n.{I18nSupport, Messages, MessagesProvider}
import play.api.libs.json._
import play.api.mvc.Results.BadRequest
import play.api.mvc._
import play.twirl.api._
import scalapb.{GeneratedMessage, GeneratedMessageCompanion}
import play.filters.csp.CSPConfig

import java.io.FileInputStream
import scala.concurrent.{ExecutionContext, Future}

trait BoxToResultHelpers extends I18nSupport with Formatter with RemoteOriginHelpers with HeaderNames {

  protected def defaultErrorCode: Int = BAD_REQUEST

  def asResult[T <: Result](b: Box[T])(implicit messages: MessagesProvider): Result = {
    val result = b match {
      case Full(result) =>
        result
      case ParamFailure(msg, h_, chain, statusCode: Int) =>
        new JsonResult(statusCode)(Messages(msg), formatChainOpt(chain))
      case ParamFailure(_s, _b, _c, msgs: JsArray) =>
        new JsonResult(defaultErrorCode)(jsonMessages(msgs))
      case Failure(msg, _, chain) =>
        new JsonResult(defaultErrorCode)(Messages(msg), formatChainOpt(chain))
      case Empty =>
        new JsonResult(NOT_FOUND)("Couldn't find the requested resource.")
    }
    allowRemoteOriginIfSelected(addNoCacheHeaderFallback(result))
  }

  private def formatChainOpt(chain: Box[Failure])(implicit messages: MessagesProvider): Option[String] = chain match {
    case Full(_) => Some(formatChain(chain))
    case _       => None
  }

  private def formatChain(chain: Box[Failure], includeTime: Boolean = true)(implicit
      messages: MessagesProvider
  ): String = chain match {
    case Full(failure) =>
      val serverTimeMsg = if (includeTime) s"[Server Time ${Instant.now}] " else ""
      serverTimeMsg + " <~ " + formatFailure(failure) + formatChain(failure.chain, includeTime = false)
    case _ => ""
  }

  private def formatFailure(failure: Failure)(implicit messages: MessagesProvider): String =
    failure match {
      case ParamFailure(msg, _, _, param) => Messages(msg) + " " + param.toString
      case Failure(msg, _, _)             => Messages(msg)
    }

  private def jsonMessages(msgs: JsArray): JsObject =
    Json.obj("messages" -> msgs)

  // Override this in your controller to add the CORS headers to the results of its actions
  def allowRemoteOrigin: Boolean = false

  private def allowRemoteOriginIfSelected(result: Result): Result =
    if (allowRemoteOrigin) {
      addRemoteOriginHeaders(result)
    } else result

  def addNoCacheHeaderFallback(result: Result): Result =
    if (result.header.headers.contains(CACHE_CONTROL)) {
      result
    } else result.withHeaders(CACHE_CONTROL -> "no-cache")
}

trait RemoteOriginHelpers {
  // The standard way is to extend BoxToResultHelpers and override allowRemoteOrigin to true in your Controller
  // Use this directly only if your controller must contain some Actions with and some without remote origin allowed

  def addRemoteOriginHeaders(result: Result): Result =
    result.withHeaders("Access-Control-Allow-Origin" -> "*", "Access-Control-Max-Age" -> "600")
}

trait CspHeaders extends HeaderNames {
  def cspConfig: CSPConfig

  private lazy val contentSecurityPolicyDirectivesString =
    cspConfig.directives.map(d => s"${d.name} ${d.value}").mkString("; ")

  def addCspHeader(result: Result): Result =
    result.withHeaders((CONTENT_SECURITY_POLICY, contentSecurityPolicyDirectivesString))

  def addCspHeader(
      action: Action[AnyContent]
  )(implicit request: Request[AnyContent], ec: ExecutionContext): Future[Result] =
    action.apply(request).map(addCspHeader)
}

trait ResultImplicits extends BoxToResultHelpers with I18nSupport {

  implicit def fox2FutureResult[T <: Result](
      b: Fox[T]
  )(implicit ec: ExecutionContext, messages: MessagesProvider): Future[Result] =
    b.futureBox.map(asResult)

  implicit def futureBox2Result[T <: Result](
      b: Box[Future[T]]
  )(implicit ec: ExecutionContext, messages: MessagesProvider): Future[Result] =
    b match {
      case Full(f) =>
        f.map(value => asResult(Full(value)))
      case Empty =>
        Future.successful(asResult(Empty))
      case f: Failure =>
        Future.successful(asResult(f))
    }

  implicit def boxFuture2Result[T <: Result](
      f: Future[Box[T]]
  )(implicit ec: ExecutionContext, messages: MessagesProvider): Future[Result] =
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

  private def createResult(content: JsValue)(implicit writeable: Writeable[JsValue]): Result =
    Result(
      header = ResponseHeader(status),
      body = HttpEntity.Strict(writeable.transform(content), writeable.contentType)
    )

  private def messageTypeFromStatus =
    if (isSuccess)
      jsonSuccess
    else
      jsonError

  def apply(json: JsValue): Result =
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

  private def jsonHTMLResult(html: Html): JsObject = {
    val htmlJson = html.body match {
      case "" =>
        Json.obj()
      case body =>
        Json.obj("html" -> body)
    }

    htmlJson
  }

  private def jsonMessages(messages: Seq[(String, String)]): JsObject =
    Json.obj("messages" -> messages.map(m => Json.obj(m._1 -> m._2)))
}

trait MimeTypes {
  val jpegMimeType: String = "image/jpeg"
  val protobufMimeType: String = "application/x-protobuf"
  val xmlMimeType: String = "application/xml"
  val zipMimeType: String = "application/zip"
  val jsonMimeType: String = "application/json"
  val formUrlEncodedMimeType: String = "application/x-www-form-urlencoded"
  val octetStreamMimeType: String = "application/octet-stream"
}

trait JsonResults extends JsonResultAttribues {
  val JsonOk = new JsonResult(OK)
  val JsonBadRequest = new JsonResult(BAD_REQUEST)
  val JsonNotFound = new JsonResult(NOT_FOUND)
}

trait JsonResultAttribues {
  val jsonSuccess = "success"
  val jsonError = "error"
}

trait ValidationHelpers {

  def validateJson[A: Reads](implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext): BodyParser[A] =
    bodyParsers.json.validate(
      _.validate[A].asEither.left.map(e => BadRequest(JsError.toJson(e)))
    )

  def validateProto[A <: GeneratedMessage](implicit
      bodyParsers: PlayBodyParsers,
      companion: GeneratedMessageCompanion[A],
      ec: ExecutionContext
  ): BodyParser[A] =
    bodyParsers.raw.validate { raw =>
      if (raw.size < raw.memoryThreshold) {
        Box(raw.asBytes())
          .flatMap(x => tryo(companion.parseFrom(x.toArray)))
          .toRight[Result](BadRequest("invalid request body"))
      } else {
        tryo(companion.parseFrom(CodedInputStream.newInstance(new FileInputStream(raw.asFile))))
          .toRight[Result](BadRequest("invalid request body"))
      }
    }

}

trait RequestTokenHelper {
  implicit def tokenContextForRequest(implicit request: Request[Any]): TokenContext =
    TokenContext(request.target.getQueryParameter("token").orElse(request.headers.get("X-Auth-Token")))
}

trait ControllerUtils
    extends JsonResults
    with BoxImplicits
    with FoxImplicits
    with ResultImplicits
    with Status
    with I18nSupport
    with MimeTypes
    with ValidationHelpers
    with LazyLogging
    with RequestTokenHelper
    with RequestLogging
