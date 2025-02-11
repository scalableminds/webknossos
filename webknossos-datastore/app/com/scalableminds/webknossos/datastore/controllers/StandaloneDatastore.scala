package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.mvc.ControllerUtils
import play.api.libs.json.Json
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents}

import javax.inject.Inject

class StandaloneDatastore @Inject() (cc: ControllerComponents) extends AbstractController(cc) with ControllerUtils {

  def buildInfo: Action[AnyContent] = Action {
    addNoCacheHeaderFallback(
      addRemoteOriginHeaders(
        Ok(
          Json.obj(
            "webknossosDatastore" -> Json.toJson(webknossosDatastore.BuildInfo.toMap.view.mapValues(_.toString).toMap)
          )
        )
      )
    )
  }
}
