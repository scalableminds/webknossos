package com.scalableminds.webknossos.tracingstore.controllers

import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, InjectedController}

class StandaloneTracingstore extends InjectedController {

  def buildInfo: Action[AnyContent] = Action {
    Ok(
      Json.obj(
        "webknossosTracingstore" -> webknossosTracingstore.BuildInfo.toMap.mapValues(_.toString)
      ))
  }
}
