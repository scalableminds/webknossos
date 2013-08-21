package controllers

import oxalis.security.Secured
import models.user._
import play.api.libs.json.Json._
import play.api.libs.json.JsValue
import play.api.libs.json._
import models.security.Role
import models.task._
import play.api.Logger
import models.tracing._
import models.binary._
import play.api.i18n.Messages
import braingames.mvc.Controller
import oxalis.user.UserCache
import models.annotation.{AnnotationType, AnnotationDAO}
import play.api.libs.concurrent.Execution.Implicits._
import views._

object UserController extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def dashboard = Authenticated {
    implicit request =>
      Async {
        val user = request.user
        val annotations = AnnotationDAO.findFor(user).filter(t => !AnnotationType.isSystemTracing(t))
        val (taskAnnotations, allExplorationalAnnotations) =
          annotations.partition(_.typ == AnnotationType.Task)

        val explorationalAnnotations =
          allExplorationalAnnotations
            .filter(!_.state.isFinished)
            .sortBy(a => -a.content.map(_.timestamp).getOrElse(0L))

        val userTasks = taskAnnotations.flatMap(a => a.task.map(_ -> a))

        val loggedTime = TimeTracking.loggedTime(user)

        DataSetDAO.findAll.map {
          dataSets =>

            Ok(html.user.dashboard.userDashboard(
              explorationalAnnotations,
              userTasks,
              loggedTime,
              dataSets,
              userTasks.find(!_._2.state.isFinished).isDefined))
        }
      }
  }

  def saveSettings = Authenticated(parser = parse.json(maxLength = 2048)) {
    implicit request =>
      request.body.asOpt[JsObject].map {
        settings =>
          if (UserConfiguration.isValid(settings)) {
            request.user.update(_.changeSettings(UserConfiguration(settings.fields.toMap)))
            UserCache.invalidateUser(request.user.id)
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