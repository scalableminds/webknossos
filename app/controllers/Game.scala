package controllers

import play.api.mvc.Controller
import play.api.libs.json.Json._
import play.api.libs.json._
import brainflight.security.Secured
import models.Role
import models.DataSet
import play.api.Logger

object Game extends Controller with Secured{
  override val DefaultAccessRole = Role("user")
  
  def initialize = Authenticated(){ user => implicit request =>
    val dataSet = DataSet.default
    val result = Json.obj(
        "dataSet" -> Json.obj(
          "id" -> dataSet.id,
          "resolutions" -> dataSet.supportedResolutions
        )
    )
    Ok( result )
  }
}