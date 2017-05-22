package controllers

import play.api._
import play.api.libs.json.Json
import play.api.mvc.Action
import play.api.mvc.Results._

class Application {

  def buildInfo = Action { implicit request =>
    Ok(Json.obj(
      "datastore" -> datastore.BuildInfo.toMap.mapValues(_.toString),
      "braingames-libs" -> braingameslibs.BuildInfo.toMap.mapValues(_.toString),
      "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString)
    ))
  }
}
