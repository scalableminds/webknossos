/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.webknossos.datastore.datastore.controllers

import play.api.libs.json.Json
import play.api.mvc.Action
import play.api.mvc.Results._

class StandaloneDatastore {

  def buildInfo = Action { implicit request =>
    Ok(Json.obj(
      "webknossosDatastore" -> webknossosDatastore.BuildInfo.toMap.mapValues(_.toString),
      "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString)
    ))
  }
}
