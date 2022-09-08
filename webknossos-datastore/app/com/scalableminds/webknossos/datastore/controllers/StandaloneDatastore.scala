package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.tools.Fox

import javax.inject.Inject
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class StandaloneDatastore @Inject()(implicit ec: ExecutionContext) extends Controller {

  def buildInfo: Action[AnyContent] = Action { implicit request =>
    addRemoteOriginHeaders(
      Ok(
        Json.obj(
          "webknossosDatastore" -> webknossosDatastore.BuildInfo.toMap.mapValues(_.toString),
          "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString)
        ))
    )
  }
}
