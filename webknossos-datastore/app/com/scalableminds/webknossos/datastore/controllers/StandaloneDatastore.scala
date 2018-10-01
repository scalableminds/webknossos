package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.tracings.skeleton.SkeletonTracingService
import play.api.libs.json.Json
import play.api.mvc.{Action, InjectedController}
import play.api.mvc.Results._

import scala.concurrent.ExecutionContext

class StandaloneDatastore @Inject()(implicit ec: ExecutionContext) extends InjectedController with RemoteOriginHelpers {

  def buildInfo = Action { implicit request =>
    AllowRemoteOrigin {
      Ok(Json.obj(
        "webknossosDatastore" -> webknossosDatastore.BuildInfo.toMap.mapValues(_.toString),
        "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString)
      ))
    }
  }
}
