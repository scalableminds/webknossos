package controllers

import javax.inject.Inject

import models.binary.DataSetDAO
import models.configuration.{DataSetConfiguration, UserConfiguration}
import models.user.UserService
import oxalis.security.WebknossosSilhouette.{UserAwareAction, UserAwareRequest, SecuredRequest, SecuredAction}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.JsObject
import play.api.libs.json.Json._
import play.api.mvc.Action

/**
 * Controller that handles the CRUD api for configurations (mostly settings for the tracing view)
 */
class ConfigurationController @Inject()(val messagesApi: MessagesApi) extends Controller {

  def default = Action { implicit request =>
    Ok(toJson(UserConfiguration.default.configuration))
  }

  def read = UserAwareAction.async { implicit request =>
    request.identity.toFox.flatMap { user =>
      UserService.findOneById(user.id, useCache = false)
      .map(_.userConfiguration.configurationOrDefaults)
    }
    .getOrElse(UserConfiguration.default.configuration)
    .map(configuration => Ok(toJson(configuration)))
  }

  def update = SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
    for {
      jsConfiguration <- request.body.asOpt[JsObject] ?~> Messages("user.configuration.invalid")
      conf = jsConfiguration.fields.toMap
      _ <- UserService.updateUserConfiguration(request.identity, UserConfiguration(conf))
    } yield {
      JsonOk(Messages("user.configuration.updated"))
    }
  }

  def defaultDataSet = Action { implicit request =>
    Ok(toJson(DataSetConfiguration.default.configuration))
  }

  def readDataSet(dataSetName: String) = UserAwareAction.async { implicit request =>
    request.identity.toFox.flatMap { user =>
      UserService.findOneById(user.id, useCache = false)
      .flatMap(_.dataSetConfigurations.get(dataSetName))
    }
    .orElse(DataSetDAO.findOneBySourceName(dataSetName).flatMap(_.defaultConfiguration))
    .getOrElse(DataSetConfiguration.default)
    .map(configuration => Ok(toJson(configuration.configurationOrDefaults)))
  }

  def updateDataSet(dataSetName: String) = SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
    for {
      jsConfiguration <- request.body.asOpt[JsObject] ?~> Messages("user.configuration.dataset.invalid")
      conf = jsConfiguration.fields.toMap
      _ <- UserService.updateDataSetConfiguration(request.identity, dataSetName, DataSetConfiguration(conf))
    } yield {
      JsonOk(Messages("user.configuration.dataset.updated"))
    }
  }
}
