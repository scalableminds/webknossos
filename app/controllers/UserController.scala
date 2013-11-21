package controllers

import oxalis.security.Secured
import models.user._
import play.api.libs.json.Json._
import play.api.libs.json._
import models.security.{RoleDAO, Role}
import play.api.i18n.Messages
import oxalis.user.UserCache
import play.api.libs.concurrent.Execution.Implicits._
import views._
import braingames.util.ExtendedTypes.ExtendedList
import braingames.util.ExtendedTypes.ExtendedBoolean

object UserController extends Controller with Secured with Dashboard {
  override val DefaultAccessRole = RoleDAO.User

  def dashboard = Authenticated().async {
    implicit request =>
      dashboardInfo(request.user).map { info =>
        Ok(html.user.dashboard.userDashboard(info))
      }
  }

  def saveSettings = Authenticated().async(parse.json(maxLength = 2048)) { implicit request =>
    (for {
      settings <- request.body.asOpt[JsObject] ?~> Messages("user.settings.invalid")
      if(UserSettings.isValid(settings))
      _ <- UserService.updateSettings(request.user, UserSettings(settings.fields.toMap))
    } yield {
      UserCache.invalidateUser(request.user.id)
      JsonOk(Messages("user.settings.updated"))
    }) ~> Messages("user.settings.invalid")
  }

  def showSettings = UserAwareAction { implicit request =>
    val configuration = request.userOpt match {
      case Some(user) =>
        user.configuration.settingsOrDefaults
      case _ =>
        UserSettings.defaultSettings.settings
    }
    Ok(toJson(configuration))
  }

  def defaultSettings = Authenticated() { implicit request =>
    Ok(toJson(UserSettings.defaultSettings.settings))
  }
}