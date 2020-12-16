package com.scalableminds.webknossos.datastore.controllers

import javax.inject.Inject
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, InjectedController}

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
