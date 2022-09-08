package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.webknossos.datastore.controllers.Controller
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class StandaloneTracingstore @Inject()(implicit ec: ExecutionContext) extends Controller {

  def buildInfo: Action[AnyContent] = Action { implicit request =>
    addRemoteOriginHeaders(
      Ok(
        Json.obj(
          "webknossosTracingstore" -> webknossosTracingstore.BuildInfo.toMap.mapValues(_.toString)
        )
      ))
  }
}
