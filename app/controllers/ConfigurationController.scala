package controllers

import javax.inject.Inject

import oxalis.security.Secured
import play.api.mvc.Action
import play.api.i18n.{MessagesApi, Messages}
import models.configuration.{UserConfiguration, DataSetConfiguration}
import models.user.UserService
import oxalis.user.UserCache
import play.api.libs.json.Json._
import play.api.libs.json.JsObject
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent.Future

/**
 * Created by tombocklisch on 03.02.14.
 */
class ConfigurationController @Inject() (val messagesApi: MessagesApi) extends Controller with Secured {

  def default = Action {
    implicit request =>
      Ok(toJson(UserConfiguration.default.configuration))
  }

  def read = UserAwareAction.async {
    implicit request =>
      request.userOpt.toFox.flatMap { user =>
        UserService.findOneById(user.id, useCache = false)
          .map(_.userConfiguration.configurationOrDefaults)
      }
        .getOrElse(UserConfiguration.default.configuration)
        .map(configuration => Ok(toJson(configuration)))
  }

  def update = Authenticated.async(parse.json(maxLength = 20480)) {
    implicit request =>
      for {
        jsConfiguration <- request.body.asOpt[JsObject] ?~> Messages("user.configuration.invalid")
        conf = jsConfiguration.fields.toMap
        _ <- UserService.updateUserConfiguration(request.user, UserConfiguration(conf))
      } yield {
        Ok
      }
  }

  def defaultDataSet = Action {
    implicit request =>
      Ok(toJson(DataSetConfiguration.default.configuration))
  }

  def readDataSet(dataSetName: String) = UserAwareAction.async {
    implicit request =>
      request.userOpt.toFox.flatMap { user =>
        UserService.findOneById(user.id, useCache = false)
          .flatMap(_.dataSetConfigurations.get(dataSetName))
      }
        .getOrElse(DataSetConfiguration.default)
        .map(configuration => Ok(toJson(configuration.configurationOrDefaults)))
  }

  def updateDataSet(dataSetName: String) = Authenticated.async(parse.json(maxLength = 20480)) {
    implicit request =>
      for {
        jsConfiguration <- request.body.asOpt[JsObject] ?~> Messages("user.configuration.invalid")
        conf = jsConfiguration.fields.toMap
        _ <- UserService.updateDataSetConfiguration(request.user, dataSetName, DataSetConfiguration(conf))
      } yield {
        Ok
      }
  }
}
