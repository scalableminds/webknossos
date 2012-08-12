package controllers

import play.api.Logger
import play.api.libs.json.Json._
import play.api.libs.json._
import models.BranchPoint
import play.api.mvc._
import org.bson.types.ObjectId
import brainflight.tools.Math._
import brainflight.security.Secured
import brainflight.tools.geometry.Vector3I
import brainflight.tools.geometry.Vector3I._
import models.{ User, TransformationMatrix }
import models.Role
import models.Origin
import models.graph.Experiment

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 19.12.11
 * Time: 11:27
 */
object Task extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createTaskInformation(user: User, task: Experiment) = {
    Json.obj(
      "task" -> task)
  }

  def initialize(dataSetId: String) = Authenticated {
    implicit request =>
      val user = request.user
      (for {
        taskId <- user.tasks.headOption
        task <- Experiment.findOneById(taskId)
      } yield Ok(createTaskInformation(user, task))) getOrElse BadRequest("Couldn't open new route.")
  }
  /**
   *
   
  def blackBox(id: String) = Authenticated(parser = parse.raw(1024 * 1024)) {
    implicit request =>
      val user = request.user
      (for {
        route <- TrackedRoute.findOpenBy(id, user)
        buffer <- request.body.asBytes(1024 * 1024)
      } yield {
        TrackedRoute.extendRoute(route, user, buffer)
        Ok
      }) getOrElse BadRequest("No open route found or byte array invalid.")

  }
  def list = Authenticated {
    implicit request =>
      val routes = TrackedRoute.findByUser(request.user)
      Ok(toJson(routes.map(_.points)))
  }

  def getRoute(id: String) = Authenticated {
    implicit request =>
      TrackedRoute.findOneById(new ObjectId(id)).map(route =>
        Ok(toJson(route.points))) getOrElse NotFound("Couldn't open route.")
  }*/
}