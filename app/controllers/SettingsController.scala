package controllers

import oxalis.security.Secured
import play.api.i18n.Messages
import models.user.{UserSettings, UserService}
import oxalis.user.UserCache
import play.api.libs.json.Json._
import play.api.libs.json.JsObject
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Created by tombocklisch on 03.02.14.
 */
object SettingsController extends Controller with Secured {

  def read = UserAwareAction {
    implicit request =>
      val configuration = request.userOpt match {
        case Some(user) =>
          user.configuration.settingsOrDefaults
        case _ =>
          UserSettings.defaultSettings.settings
      }
      Ok(toJson(configuration))
  }

  def update = UserAwareAction.async(parse.json(maxLength = 2048)) {
    implicit request =>
      for {
        settings <- request.body.asOpt[JsObject] ?~> Messages("user.settings.invalid")
        _ <- UserService.updateSettings(request.userOpt, UserSettings(settings.fields.toMap))
      } yield {
        request.userOpt.map { user =>
          UserCache.invalidateUser(user.id)
        }

        JsonOk(Messages("user.settings.updated"))
      }
  }

  def default = Authenticated {
    implicit request =>
      Ok(toJson(UserSettings.defaultSettings.settings))
  }
}
