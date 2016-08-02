/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.datastore.controllers

import play.api.i18n.I18nSupport
import play.api.mvc.{Controller => PlayController, _}
import com.scalableminds.util.mvc.ExtendedController
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._

trait Controller 
  extends PlayController 
          with RemoteOriginHelpers 
          with ExtendedController 
          with I18nSupport 
          with LazyLogging

trait RemoteOriginHelpers {

  def AllowRemoteOrigin(f: => Future[Result]): Future[Result] =
    f.map(addHeadersToResult)

  def AllowRemoteOrigin(f: => Result): Result =
    addHeadersToResult(f)

  def addHeadersToResult(result: Result): Result =
    result.withHeaders("Access-Control-Allow-Origin" -> "*", "Access-Control-Max-Age" -> "600")

  case class AllowRemoteOrigin[A](action: Action[A]) extends Action[A] {

    def apply(request: Request[A]): Future[Result] =
      AllowRemoteOrigin(action(request))

    lazy val parser = action.parser
  }

}