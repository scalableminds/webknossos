package com.scalableminds.webknossos.datastore.controllers

import play.api.libs.json.Json
import play.api.mvc.InjectedController

import javax.inject.Inject
import scala.concurrent.ExecutionContext

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
