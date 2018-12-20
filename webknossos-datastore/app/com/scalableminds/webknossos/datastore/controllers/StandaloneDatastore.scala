package com.scalableminds.webknossos.datastore.controllers

import javax.inject.Inject
import play.api.libs.json.Json
import play.api.mvc.{Action, InjectedController}

import scala.concurrent.ExecutionContext
import play.api.mvc.Results._

class StandaloneDatastore @Inject()(implicit ec: ExecutionContext) extends InjectedController with RemoteOriginHelpers {

  def buildInfo = Action { implicit request =>
    AllowRemoteOrigin {
      Ok(
        Json.obj(
          "webknossosDatastore" -> webknossosDatastore.BuildInfo.toMap.mapValues(_.toString),
          "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString)
        ))
    }
  }
}
