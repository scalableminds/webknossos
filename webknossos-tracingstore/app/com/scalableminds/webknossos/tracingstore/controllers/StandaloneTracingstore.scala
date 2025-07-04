package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.util.mvc.ApiVersioning
import com.scalableminds.webknossos.datastore.controllers.Controller
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}

import javax.inject.Inject

class StandaloneTracingstore @Inject()() extends Controller with ApiVersioning {

  def buildInfo: Action[AnyContent] = Action {
    addNoCacheHeaderFallback(
      addRemoteOriginHeaders(
        Ok(
          Json.obj(
            "webknossosTracingstore" -> Json.toJson(
              webknossosTracingstore.BuildInfo.toMap.view.mapValues(_.toString).toMap),
            "httpApiVersioning" -> apiVersioningInfo,
          )
        )))
  }
}
