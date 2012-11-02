package controllers

import brainflight.security.Secured
import play.api.mvc.Controller
import models.user._
import play.api.mvc.Action
import play.api.mvc.Request
import play.api.libs.json.Json._
import play.api.libs.json.JsValue
import play.api.libs.json._
import models.security.Role
import models.task._
import views.html

object UserController extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def dashboard = Authenticated { implicit request =>
    val user = request.user
    val experiments = Experiment.findFor(user)
    val (tempExperiments, taskExperiments) = 
      experiments.partition(_.taskId.isEmpty)
      
    val userTasks = taskExperiments.flatMap( e => 
      Task.findOneById(e.taskId.get).map(_ -> e))
      
    val loggedTime = TimeTracking.loggedTime(user)
      
    Ok(html.user.dashboard(user, tempExperiments, userTasks, loggedTime))
  }
  
  def logTime(time: Int) = Authenticated{ implicit request =>
    TimeTracking.logTime(request.user, time)
    Ok
  }

  def saveSettings = Authenticated(parser = parse.json(maxLength = 2048)) {
    implicit request =>
      request.body.asOpt[JsObject] map { settings =>
        val fields = settings.fields take (UserConfiguration.MaxSettings) filter (UserConfiguration.isValidSetting)
        User.save(request.user.copy(configuration = UserConfiguration(fields.toMap)))
        Ok
      } getOrElse (BadRequest)
  }

  def showSettings = Authenticated {
    implicit request =>
      Ok(toJson(request.user.configuration.settingsOrDefaults))
  }
}