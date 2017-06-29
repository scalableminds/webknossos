/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.scalableminds.util.mvc.ExtendedController
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsError, Reads}
import play.api.mvc.Results.{BadRequest, Forbidden}
import play.api.mvc.{Controller => PlayController, _}
import play.api.{Mode, Play}

import scala.concurrent.Future

trait Controller
  extends PlayController
    with ExtendedController
    with RemoteOriginHelpers
    with JsonValidationHelpers
    with LazyLogging

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

trait JsonValidationHelpers {

  def validateJson[A : Reads] = BodyParsers.parse.json.validate(
    _.validate[A].asEither.left.map(e => BadRequest(JsError.toJson(e)))
  )
}

case class TokenSecuredAction(dataSetName: String, dataLayerName: String) extends ActionBuilder[Request] {

  val debugModeEnabled = Play.current.configuration.getBoolean("datastore.debugMode").getOrElse(false)

  def invokeBlock[A](request: Request[A], block: (Request[A]) => Future[Result]): Future[Result] = {
    hasUserAccess(request).flatMap {
      case true =>
        block(request)
      case _ if debugModeEnabled && Play.mode(Play.current) != Mode.Prod =>
        // If we are in development mode, lets skip tokens
        block(request)
      case false =>
        Future.successful(Forbidden("Invalid access token."))
    }
  }

  private def hasUserAccess[A](request: Request[A]): Future[Boolean] = {
    Future.successful(true)
  }
}
