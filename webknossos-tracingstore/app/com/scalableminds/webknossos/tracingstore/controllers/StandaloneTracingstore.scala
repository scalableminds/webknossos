package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.controllers.Controller
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class StandaloneTracingstore @Inject()(implicit ec: ExecutionContext) extends Controller {

  override def allowRemoteOrigin: Boolean = true

  def buildInfo: Action[AnyContent] = Action.async { implicit request =>
    Fox.successful(
      Ok(
        Json.obj(
          "webknossosTracingstore" -> webknossosTracingstore.BuildInfo.toMap.mapValues(_.toString)
        )
      )
    )
  }
}
