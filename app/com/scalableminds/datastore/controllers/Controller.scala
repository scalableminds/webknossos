/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.datastore.controllers

import play.api.mvc.{Controller => PlayController, _}
import com.scalableminds.util.mvc.ExtendedController
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._

trait Controller extends PlayController with RemoteOriginHelpers with ExtendedController

trait RemoteOriginHelpers {

  def AllowRemoteOrigin(f: => Future[SimpleResult]) =
    f.map(addHeadersToResult)

  def AllowRemoteOrigin(f: => SimpleResult) =
    addHeadersToResult(f)

  def addHeadersToResult(result: SimpleResult) =
    result.withHeaders("Access-Control-Allow-Origin" -> "*")

  case class AllowRemoteOrigin[A](action: Action[A]) extends Action[A] {

    def apply(request: Request[A]): Future[SimpleResult] =
      action(request).map(_.withHeaders("Access-Control-Allow-Origin" -> "*"))

    lazy val parser = action.parser
  }

}