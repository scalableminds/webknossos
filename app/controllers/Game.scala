package controllers

import play.api.mvc.Controller
import play.api.libs.json.Json._
import play.api.libs.json._
import brainflight.security.Secured
import models.Role
import models.DataSet
import play.api.Logger

object Game extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createDataSetInformation( dataSet: DataSet ) = Json.obj(
    "dataSet" -> Json.obj(
      "id" -> dataSet.id,
      "resolutions" -> dataSet.supportedResolutions,
      "upperBoundary" -> dataSet.maxCoordinates ) )

  def initialize = Authenticated { implicit request =>
    Ok( createDataSetInformation( DataSet.default ) )
  }
}