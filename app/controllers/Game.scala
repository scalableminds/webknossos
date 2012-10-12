package controllers

import play.api.mvc.Controller
import play.api.libs.json.Json._
import play.api.libs.json._
import brainflight.security.Secured
import models.Role
import models.DataSet
import play.api.Logger
import models.graph.Experiment
import models.User

object Game extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createExperimentIDInfo(experimentId: String) = Json.obj(
    "task" -> Json.obj(
      "id" -> experimentId))

  def initialize = Authenticated { implicit request =>
    val experimentId = request.user.experiments match {
      case experimentId :: _ =>
        experimentId.toString
      case _ =>
        val exp = Experiment.createNew()
        User.save(request.user.copy(experiments = exp._id :: request.user.experiments))
        exp.id
    }
    Ok(createExperimentIDInfo(experimentId)) 
  }
}