package com.scalableminds.webknossos.tracingstore.controllers

import play.api.libs.json.Json
import play.api.mvc.Action
import play.api.mvc.Results._


class StandaloneTracingstore {

  def buildInfo = Action { implicit request =>
    Ok(Json.obj(
      "webknossosTracingstore" -> webknossosTracingstore.BuildInfo.toMap.mapValues(_.toString)
    ))
  }
}
