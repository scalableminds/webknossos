package com.scalableminds.webknossos.datastore.controllers

import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, InjectedController}

import javax.inject.Inject

class StandaloneDatastore @Inject()() extends InjectedController with RemoteOriginHelpers {

  def buildInfo: Action[AnyContent] = Action {
    AllowRemoteOrigin {
      Ok(
        Json.obj(
          "webknossosDatastore" -> webknossosDatastore.BuildInfo.toMap.mapValues(_.toString),
          "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString)
        ))
    }
  }
}
