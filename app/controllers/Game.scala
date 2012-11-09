package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import brainflight.security.Secured
import models.security.Role
import models.binary.DataSet
import play.api.Logger
import models.task.Experiment
import models.user._
import models.task.UsedExperiments
import views._

object Game extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createExperimentIDInfo(experimentId: String) = Json.obj(
    "task" -> Json.obj(
      "id" -> experimentId))
      
  def index = Authenticated { implicit request =>      
    if(Experiment.findFor(request.user).isEmpty)
      Redirect(routes.UserController.dashboard)
    else
      Ok(html.oxalis.trace(request.user))
  }
  
  def trace(experimentId: String) = Authenticated { implicit request =>
    val user = request.user
    
    Experiment.findOneById(experimentId)
      .filter( _._user == user._id)
      .map(exp => UsedExperiments.use(user, exp))
      
    Ok(html.oxalis.trace(user))
  }
  
  def reviewTrace(experimentId: String) = Authenticated(role = Role.Admin){ implicit request =>
    val user = request.user
    
    Experiment.findOneById(experimentId)
      .map(exp => UsedExperiments.use(user, exp))
      
    // TODO: set oxalis to read only
    Ok(html.oxalis.trace(user))
  }

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