package controllers

import brainflight.security.Secured
import models.user._
import play.api.mvc.Action
import play.api.mvc.Request
import play.api.libs.json.Json._
import play.api.libs.json.JsValue
import play.api.libs.json._
import models.security.Role
import models.task._
import models.binary.DataSet
import views._
import play.api.Logger
import models.tracing._
import play.api.i18n.Messages
import braingames.mvc.Controller

object UserController extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def dashboard = Authenticated { implicit request =>
    val user = request.user
    val tracings = Tracing.findFor(user)
    val (taskTracings, allExplorationalTracings) =
      tracings.partition(_.tracingType == TracingType.Task)

    val explorationalTracings = 
      allExplorationalTracings
      .filter(!_.state.isFinished)
      .sortBy( -_.timestamp )

    val userTasks = taskTracings.flatMap(e => e.task.map(_ -> e))

    val loggedTime = TimeTracking.loggedTime(user)

    val dataSets = DataSet.findAll

    Ok(html.user.dashboard.dashboard(
      explorationalTracings,
      userTasks,
      loggedTime,
      dataSets))
  }

  def saveSettings = Authenticated(parser = parse.json(maxLength = 2048)) {
    implicit request =>
      request.body.asOpt[JsObject].map{ settings =>
        if(UserConfiguration.isValid(settings)){
          request.user.update(_.changeSettings(UserConfiguration(settings.fields.toMap)))
          Ok
        } else
          BadRequest("Invalid settings")
      } ?~ Messages("user.settings.invalid")
  }

  def showSettings = Authenticated {
    implicit request =>
      Ok(toJson(request.user.configuration.settingsOrDefaults))
  }
  
  def defaultSettings = Authenticated {
    implicit request =>
      Ok(toJson(UserConfiguration.defaultConfiguration.settings))
  }
}