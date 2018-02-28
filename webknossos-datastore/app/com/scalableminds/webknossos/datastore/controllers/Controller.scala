/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.webknossos.datastore.controllers

import java.io.FileInputStream

import com.google.protobuf.CodedInputStream
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.{AccessTokenService, UserAccessAnswer, UserAccessRequest}
import com.trueaccord.scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.util.Helpers.tryo
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsError, Reads}
import play.api.mvc.Results.BadRequest
import play.api.mvc.{Controller => PlayController, _}

import scala.concurrent.Future

trait Controller
  extends PlayController
    with ExtendedController
    with RemoteOriginHelpers
    with ValidationHelpers
    with LazyLogging

trait TokenSecuredController extends Controller {

  def accessTokenService: AccessTokenService

  case class TokenSecuredAction(accessRequest: UserAccessRequest) extends ActionBuilder[Request] {

    private def hasUserAccess[A](implicit request: Request[A]): Fox[UserAccessAnswer] = {
      request.getQueryString("token").map { token =>
        accessTokenService.hasUserAccess(token, accessRequest)
      }.getOrElse(Fox.successful(UserAccessAnswer(false, Some("No access token."))))
    }

    def invokeBlock[A](request: Request[A], block: (Request[A]) => Future[Result]): Future[Result] = {
      hasUserAccess(request).flatMap {
        case UserAccessAnswer(true, _) =>
          block(request)
        case UserAccessAnswer(false, Some(msg)) =>
          Future.successful(Forbidden("Forbidden: " + msg))
        case _ =>
          Future.successful(Forbidden("Token authentication failed"))
      }
    }
  }
}

trait RemoteOriginHelpers {

  def AllowRemoteOrigin(f: => Future[Result]): Future[Result] =
    f.map(addHeadersToResult)

  def AllowRemoteOrigin(f: => Result): Result =
    addHeadersToResult(f)

  def addHeadersToResult(result: Result): Result =
    result.withHeaders("Access-Control-Allow-Origin" -> "*", "Access-Control-Max-Age" -> "600")

  case class AllowRemoteOrigin[A](action: Action[A]) extends Action[A] {

    lazy val parser = action.parser

    def apply(request: Request[A]): Future[Result] =
      AllowRemoteOrigin(action(request))
  }
}

trait ValidationHelpers {

  def validateJson[A : Reads] = BodyParsers.parse.json.validate(
    _.validate[A].asEither.left.map(e => BadRequest(JsError.toJson(e)))
  )

  def validateProto[A <: GeneratedMessage with Message[A]](implicit companion: GeneratedMessageCompanion[A]) = BodyParsers.parse.raw.validate { raw =>
    if (raw.size < raw.memoryThreshold) {
      Box(raw.asBytes()).flatMap(x => tryo(companion.parseFrom(x))).toRight[Result](BadRequest("invalid request body"))
    } else {
      tryo(companion.parseFrom(CodedInputStream.newInstance(new FileInputStream(raw.asFile)))).toRight[Result](BadRequest("invalid request body"))
    }
  }
}
