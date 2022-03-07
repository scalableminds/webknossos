package com.scalableminds.webknossos.datastore.controllers

import javax.inject.Inject
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}

class StandaloneDatastore @Inject()() extends Controller {

  override def allowRemoteOrigin: Boolean = true

  def buildInfo: Action[AnyContent] = Action {
    Ok(
        Json.obj(
          "webknossosDatastore" -> webknossosDatastore.BuildInfo.toMap.mapValues(_.toString),
          "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString)
        ))
  }
}
