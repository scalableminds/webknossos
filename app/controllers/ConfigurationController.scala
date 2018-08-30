package controllers

import com.scalableminds.util.tools.Fox
import javax.inject.Inject

import models.binary.{DataSet, DataSetDAO}
import models.configuration.{DataSetConfiguration, UserConfiguration}
import models.team.OrganizationDAO
import models.user.{UserDataSetConfigurationDAO, UserService}
import oxalis.security.WebknossosSilhouette.{SecuredAction, UserAwareAction}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsObject, JsValue}
import play.api.libs.json.Json._
import play.api.mvc.Result
import utils.ObjectId


class ConfigurationController @Inject()(val messagesApi: MessagesApi) extends Controller {

  def read = UserAwareAction.async { implicit request =>
    request.identity.toFox.flatMap { user =>
      for {
        userConfig <- user.userConfigurationStructured
      } yield userConfig.configurationOrDefaults
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

  def readDataSet(organizationName: String, dataSetName: String) = UserAwareAction.async { implicit request =>
    request.identity.toFox.flatMap { user =>
      for {
        configurationJson: JsValue <- UserDataSetConfigurationDAO.findOneForUserAndDataset(user._id, dataSetName)
      } yield DataSetConfiguration(configurationJson.validate[Map[String, JsValue]].getOrElse(Map.empty))
    }.orElse(
      for {
        dataSet <- DataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)
        config <- dataSet.defaultConfiguration
      } yield config
    )
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
    DataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization).flatMap { dataSet: DataSet =>
      dataSet.defaultConfiguration match {
        case Some(c) => Fox.successful(Ok(toJson(c.configurationOrDefaults)))
        case _ => DataSetConfiguration.constructInitialDefault(dataSet).map(c => Ok(toJson(c.configurationOrDefaults)))
      }
    }
  }

  def updateDataSetDefault(dataSetName: String) = SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
    for {
      dataset <- DataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization) ?~> Messages("dataset.notFound")
      _ <- Fox.assertTrue(request.identity.isTeamManagerOrAdminOfOrg(dataset._organization)) ?~> Messages("notAllowed")
      jsConfiguration <- request.body.asOpt[JsObject] ?~> Messages("user.configuration.dataset.invalid")
      conf = jsConfiguration.fields.toMap
      _ <- DataSetDAO.updateDefaultConfigurationByName(dataSetName, DataSetConfiguration(conf))
    } yield {
      JsonOk(Messages("user.configuration.dataset.updated"))
    }
  }
}
