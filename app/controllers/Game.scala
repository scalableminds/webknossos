package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import brainflight.security.Secured
import models.security.Role
import models.binary.DataSet
import play.api.Logger
import models.tracing.Tracing
import models.user._
import models.tracing.UsedTracings
import views._

object Game extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createTracingIDInfo(tracingId: String) = Json.obj(
    "task" -> Json.obj(
      "id" -> tracingId))

  def index = Authenticated { implicit request =>
    UsedTracings
      .by(request.user)
      .headOption
      .flatMap(Tracing.findOneById)
      .map(tracing => Ok(html.oxalis.trace(tracing)))
      .getOrElse(Redirect(routes.UserController.dashboard))
  }

  def trace(tracingId: String) = Authenticated { implicit request =>
    val user = request.user

    Tracing.findOneById(tracingId)
      .filter(_._user == user._id)
      .map { tracing =>
        UsedTracings.use(user, tracing)
        Ok(html.oxalis.trace(tracing))
      }
      .getOrElse(BadRequest("Tracing not found."))
  }

  def reviewTrace(tracingId: String) = Authenticated(role = Role.Admin) { implicit request =>
    val user = request.user

    Tracing.findOneById(tracingId)
      .map { tracing =>
        UsedTracings.use(user, tracing)
        Ok(html.oxalis.trace(tracing))
      }
      .getOrElse(BadRequest("Tracing not found."))
  }

  def initialize = Authenticated { implicit request =>
    val user = request.user
    UsedTracings.by(user) match {
      case tracing :: _ =>
        Ok(createTracingIDInfo(tracing.toString))
      case _ =>
        BadRequest("No open tracing found.")
    }
  }
}