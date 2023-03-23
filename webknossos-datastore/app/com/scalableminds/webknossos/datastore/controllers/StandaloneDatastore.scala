package com.scalableminds.webknossos.datastore.controllers

import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}

import javax.inject.Inject

class StandaloneDatastore @Inject()() extends Controller {

  def buildInfo: Action[AnyContent] = Action {
    addNoCacheHeaderFallback(
      addRemoteOriginHeaders(
        Ok(Json.obj(
          "webknossosDatastore" -> webknossosDatastore.BuildInfo.toMap.mapValues(_.toString),
          "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString)
        ))
      ))
  }
}
