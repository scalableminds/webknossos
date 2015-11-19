/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.datastore.controllers

import play.api.i18n.I18nSupport
import play.api.mvc.{Controller => PlayController, _}
import com.scalableminds.util.mvc.ExtendedController
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._

trait Controller extends PlayController with RemoteOriginHelpers with ExtendedController with I18nSupport

trait RemoteOriginHelpers {

  def AllowRemoteOrigin(f: => Future[Result]) =
    f.map(addHeadersToResult)

  def AllowRemoteOrigin(f: => Result) =
    addHeadersToResult(f)

  def addHeadersToResult(result: Result) =
    result.withHeaders("Access-Control-Allow-Origin" -> "*")

  case class AllowRemoteOrigin[A](action: Action[A]) extends Action[A] {

    def apply(request: Request[A]): Future[Result] =
      action(request).map(_.withHeaders("Access-Control-Allow-Origin" -> "*"))

    lazy val parser = action.parser
  }

}