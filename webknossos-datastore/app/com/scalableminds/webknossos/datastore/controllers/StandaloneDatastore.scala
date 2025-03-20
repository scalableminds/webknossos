package com.scalableminds.webknossos.datastore.controllers

import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}

import javax.inject.Inject

class StandaloneDatastore @Inject()() extends Controller {

  def buildInfo: Action[AnyContent] = Action {
    addNoCacheHeaderFallback(
      addRemoteOriginHeaders(
        Ok(
          Json.obj(
            "webknossosDatastore" -> Json.toJson(webknossosDatastore.BuildInfo.toMap.view.mapValues(_.toString).toMap)
          ))
      ))
  }
}
