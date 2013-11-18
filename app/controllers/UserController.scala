package controllers

import oxalis.security.Secured
import models.user._
import play.api.libs.json.Json._
import play.api.libs.json.JsValue
import play.api.libs.json._
import models.security.{RoleDAO, Role}
import models.task._
import play.api.Logger
import models.tracing._
import models.binary._
import play.api.i18n.Messages
import oxalis.user.UserCache
import models.annotation.{Annotation, AnnotationService, AnnotationType, AnnotationDAO}
import play.api.libs.concurrent.Execution.Implicits._
import views._
import models.user.time.{TimeTrackingService, TimeTrackingDAO, TimeTracking}
import scala.concurrent.Future
import models.user.time.TimeTracking.LoggedPerPaymentInterval
import braingames.binary.models.DataSet
import braingames.util.ExtendedTypes.ExtendedList

object UserController extends Controller with Secured with Dashboard{
  override val DefaultAccessRole = RoleDAO.User

  def dashboard = Authenticated {
    implicit request =>
      Async {
        dashboardInfo(request.user).map { info =>
          Ok(html.user.dashboard.userDashboard(info))
        }
      }
  }

  def saveSettings = Authenticated(parser = parse.json(maxLength = 2048)) {
    implicit request =>
      Async {
        (for {
          settings <- request.body.asOpt[JsObject] ?~> Messages("user.settings.invalid")
          if (UserSettings.isValid(settings))
          _ <- UserService.updateSettings(request.user, UserSettings(settings.fields.toMap))
        } yield {
          UserCache.invalidateUser(request.user.id)
          JsonOk(Messages("user.settings.updated"))
        }) ~> JsonBadRequest(Messages("user.settings.invalid"))
      }
  }

  def showSettings = UserAwareAction {
    implicit request =>
      val configuration = request.userOpt match {
        case Some(user) =>
          user.configuration.settingsOrDefaults
        case _ =>
          UserSettings.defaultSettings.settings
      }
      Ok(toJson(configuration))
  }

  def defaultSettings = Authenticated {
    implicit request =>
      Ok(toJson(UserSettings.defaultSettings.settings))
  }
}