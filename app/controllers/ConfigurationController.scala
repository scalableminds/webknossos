package controllers

import oxalis.security.Secured
import play.api.mvc.Action
import play.api.i18n.Messages
import models.configuration.{UserConfiguration, DataSetConfiguration}
import models.user.UserService
import oxalis.user.UserCache
import play.api.libs.json.Json._
import play.api.libs.json.JsObject
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Created by tombocklisch on 03.02.14.
 */
object ConfigurationController extends Controller with Secured {

  def default = Action {
    implicit request =>
      Ok(toJson(UserConfiguration.default.configuration))
  }

  def read = UserAwareAction {
    implicit request =>
      val configuration = request.userOpt match {
        case Some(user) =>
          user.userConfiguration.configurationOrDefaults
        case _ =>
          UserConfiguration.default.configuration
      }
      Ok(toJson(configuration))
  }

  def update = Authenticated.async(parse.json(maxLength = 2048)) {
    implicit request =>
      for {
        configuration <- request.body.asOpt[JsObject] ?~> Messages("user.configuration.invalid")
        _ <- UserService.updateUserConfiguration(request.user, UserConfiguration(configuration.fields.toMap))
      } yield {
        JsonOk(Messages("user.configuration.updated"))
      }
  }

  def defaultDataSet = Action {
    implicit request =>
      Ok(toJson(DataSetConfiguration.default.configuration))
  }

  def readDataSet(dataSetName: String) = UserAwareAction {
    implicit request =>
      val configuration = request.userOpt.flatMap {
        user =>
          user.dataSetConfigurations.get(dataSetName)
      }.getOrElse(DataSetConfiguration.default).configuration
      Ok(toJson(configuration))
  }

  def updateDataSet(dataSetName: String) = Authenticated.async(parse.json(maxLength = 2048)) {
    implicit request =>
      for {
        configuration <- request.body.asOpt[JsObject] ?~> Messages("user.configuration.invalid")
        _ <- UserService.updateDataSetConfiguration(request.user, dataSetName, DataSetConfiguration(configuration.fields.toMap))
      } yield {
        JsonOk(Messages("user.configuration.updated"))
      }
  }

}
