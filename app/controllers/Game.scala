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
    if(UsedTracings.by(request.user).isEmpty)
      Redirect(routes.UserController.dashboard)
    else
      Ok(html.oxalis.trace())
  }
  
  def trace(tracingId: String) = Authenticated { implicit request =>
    val user = request.user
    
    Tracing.findOneById(tracingId)
      .filter( _._user == user._id)
      .map(exp => UsedTracings.use(user, exp))
      
    Ok(html.oxalis.trace())
  }
  
  def reviewTrace(tracingId: String) = Authenticated(role = Role.Admin){ implicit request =>
    val user = request.user
    
    Tracing.findOneById(tracingId)
      .map(exp => UsedTracings.use(user, exp))
      
    Ok(html.oxalis.trace())
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