package com.scalableminds.webknossos.datastore.controllers

import com.google.protobuf.CodedInputStream
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.util.requestlogging.RequestLogging
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.{JsError, Reads}
import play.api.mvc.Results._
import play.api.mvc._
import scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}

import java.io.FileInputStream
import scala.concurrent.{ExecutionContext, Future}

trait Controller
    extends InjectedController
    with ExtendedController
    with RemoteOriginHelpers
    with ValidationHelpers
    with LazyLogging
    with RequestLogging

trait RemoteOriginHelpers {

  def AllowRemoteOrigin(f: => Future[Result])(implicit ec: ExecutionContext): Future[Result] =
    f.map(addHeadersToResult)

  def AllowRemoteOrigin(f: => Result): Result =
    addHeadersToResult(f)

  def addHeadersToResult(result: Result): Result =
    result.withHeaders("Access-Control-Allow-Origin" -> "*", "Access-Control-Max-Age" -> "600")

  case class AllowRemoteOrigin[A](action: Action[A])(implicit val executionContext: ExecutionContext)
      extends Action[A] {

    lazy val parser: BodyParser[A] = action.parser

    def apply(request: Request[A]): Future[Result] =
      AllowRemoteOrigin(action(request))
  }
}

trait ValidationHelpers {

  def validateJson[A: Reads](implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext): BodyParser[A] =
    bodyParsers.json.validate(
      _.validate[A].asEither.left.map(e => BadRequest(JsError.toJson(e)))
    )

  def validateProto[A <: GeneratedMessage with Message[A]](implicit bodyParsers: PlayBodyParsers,
                                                           companion: GeneratedMessageCompanion[A],
                                                           ec: ExecutionContext): BodyParser[A] =
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
