package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.webknossos.datastore.controllers.Controller
import play.api.mvc.{Action, AnyContent}

import javax.inject.Inject

class StandaloneTracingstore @Inject()() extends Controller {

  def buildInfo: Action[AnyContent] = Action {
    addRemoteOriginHeaders(
      Ok/*(
        Json.obj(
          "webknossosTracingstore" -> webknossosTracingstore.BuildInfo.toMap.mapValues(_.toString)
        )
      )*/)
  }
}
