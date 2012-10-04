package controllers

import play.api.mvc.Controller
import play.api.libs.json.Json._
import play.api.libs.json._
import brainflight.security.Secured
import models.Role
import models.DataSet
import play.api.Logger
import models.graph.Experiment

object Game extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createExperimentIDInfo(experiment: Experiment) = Json.obj(
    "task" -> Json.obj(
      "id" -> experiment.id))

  def initialize = Authenticated { implicit request =>
    val experimentId = request.user.headExperimentOrDefault
    (for {
      experiment <- Experiment.findOneById(experimentId)
    } yield Ok(createExperimentIDInfo(experiment))) getOrElse BadRequest("Couldn't open experiment.")
  }
}