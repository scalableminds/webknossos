package com.scalableminds.webknossos.tracingstore.controllers

import play.api.libs.json.Json
import play.api.mvc.InjectedController

class StandaloneTracingstore extends InjectedController {

  def buildInfo = Action { implicit request =>
    Ok(
      Json.obj(
        "webknossosTracingstore" -> webknossosTracingstore.BuildInfo.toMap.mapValues(_.toString)
      ))
  }
}
