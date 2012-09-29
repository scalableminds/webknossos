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

  def createTaskInformation(task: Experiment) = Json.obj(
    "task" -> Json.obj(
      "id" -> task.id))

  def initialize = Authenticated { implicit request =>
    (for {
      taskId <- request.user.tasks.headOption
      task <- Experiment.findOneById(taskId)
    } yield Ok(createTaskInformation(task))) getOrElse BadRequest("Couldn't open task.")
  }
}