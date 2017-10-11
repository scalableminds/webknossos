/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import java.io.FileInputStream

import com.google.protobuf.CodedInputStream
import com.scalableminds.braingames.datastore.services.{AccessTokenService, UserAccessRequest}
import com.scalableminds.util.mvc.ExtendedController
import com.trueaccord.scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.util.Helpers.tryo
import play.api.Play
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

    val debugModeEnabled = Play.current.configuration.getBoolean("datastore.debugMode").getOrElse(false)

    private def hasUserAccess[A](implicit request: Request[A]): Future[Boolean] = {
      // TODO RocksDB if (debugModeEnabled && Play.mode(Play.current) != Mode.Prod) {
      //  return Future.successful(true)
      //}

      request.getQueryString("token").map { token =>
        accessTokenService.hasUserAccess(token, accessRequest)
      }.getOrElse(Future.successful(false))
    }

    def invokeBlock[A](request: Request[A], block: (Request[A]) => Future[Result]): Future[Result] = {
      hasUserAccess(request).flatMap {
        case true =>
          block(request)
        case false =>
          Future.successful(Forbidden("No access token."))
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
