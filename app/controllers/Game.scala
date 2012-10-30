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
import models.UsedExperiments

object Game extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createExperimentIDInfo(experimentId: String) = Json.obj(
    "task" -> Json.obj(
      "id" -> experimentId))

  def initialize = Authenticated { implicit request =>
    val user = request.user
    val experimentId = UsedExperiments.by(user) match {
      case experiment :: _ =>
        experiment.toString
      case _ =>
        val exp = Experiment.createNew(user)
        UsedExperiments.use(user, exp)
        exp.id
    }
    Ok(createExperimentIDInfo(experimentId))
  }
}