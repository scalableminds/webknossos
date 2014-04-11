package com.scalableminds.datastore.controllers


import play.api.mvc.{Controller => PlayController, _}
import braingames.mvc.ExtendedController
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._

trait Controller extends PlayController with RemoteOriginHelpers with ExtendedController

trait RemoteOriginHelpers{
  //TODO: after update of securesocial to 2.2 remove duplication of Access-Control... and change Result to SimpleResult

  def AllowRemoteOrigin(f: => Future[SimpleResult]) =
    f.map(addHeadersToResult)

  def AllowRemoteOrigin(f: => SimpleResult) =
    addHeadersToResult(f)

  def addHeadersToResult(result: SimpleResult) =
    result.withHeaders("Access-Control-Allow-Origin" -> "*")

  case class AllowRemoteOrigin[A](action: Action[A]) extends Action[A] {

    def apply(request: Request[A]): Future[SimpleResult] =
      action(request).map( _.withHeaders("Access-Control-Allow-Origin" -> "*") )

    lazy val parser = action.parser
  }
}