package controllers

import javax.inject.Inject

import models.binary.{DataSet, DataSetDAO, DataSetSQLDAO}
import models.configuration.{DataSetConfiguration, UserConfiguration}
import models.user.UserService
import oxalis.security.WebknossosSilhouette.{SecuredAction, SecuredRequest, UserAwareAction, UserAwareRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.JsObject
import play.api.libs.json.Json._
import play.api.mvc.Action
import play.libs.Json

/**
 * Controller that handles the CRUD api for configurations (mostly settings for the tracing view)
 */
class ConfigurationController @Inject()(val messagesApi: MessagesApi) extends Controller {

  def read = UserAwareAction.async { implicit request =>
    request.identity.toFox.flatMap { user =>
      UserService.findOneById(user._id, useCache = false)
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

  def readDataSet(dataSetName: String) = UserAwareAction.async { implicit request =>
    request.identity.toFox.flatMap { user =>
      UserService.findOneById(user.id, useCache = false)
      .flatMap(_.dataSetConfigurations.get(dataSetName))
    }
    .orElse(DataSetDAO.findOneBySourceName(dataSetName).flatMap(_.defaultConfiguration))
    .getOrElse(DataSetConfiguration.constructInitialDefault(List()))
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

  def readDataSetDefault(dataSetName: String) = SecuredAction.async { implicit request =>
    for {
      dataset: DataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataset.notFound")
    } yield {
      Ok(toJson(dataset.defaultConfiguration.getOrElse(DataSetConfiguration.constructInitialDefault(dataset)).configurationOrDefaults))
    }
  }

  def updateDataSetDefault(dataSetName: String) = SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
    for {
      dataset <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataset.notFound")
      _ <- (request.identity.isAdminOf(dataset.owningOrganization) || request.identity.isTeamManagerInOrg(dataset.owningOrganization)) ?~> Messages("notAllowed")
      jsConfiguration <- request.body.asOpt[JsObject] ?~> Messages("user.configuration.dataset.invalid")
      conf = jsConfiguration.fields.toMap
      _ <- DataSetSQLDAO.updateDefaultConfigurationByName(dataSetName, DataSetConfiguration(conf))
    } yield {
      JsonOk(Messages("user.configuration.dataset.updated"))
    }
  }
}
