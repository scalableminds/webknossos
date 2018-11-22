package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import javax.inject.Inject

import models.binary.{DataSet, DataSetDAO}
import models.configuration.{DataSetConfiguration, DataSetConfigurationDefaults, UserConfiguration}
import models.user.{UserDataSetConfigurationDAO, UserService}
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.{JsObject, JsValue}
import play.api.libs.json.Json._

import scala.concurrent.ExecutionContext

class ConfigurationController @Inject()(userService: UserService,
                                        dataSetDAO: DataSetDAO,
                                        userDataSetConfigurationDAO: UserDataSetConfigurationDAO,
                                        dataSetConfigurationDefaults: DataSetConfigurationDefaults,
                                        sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller {

  def read = sil.UserAwareAction.async { implicit request =>
    request.identity.toFox.flatMap { user =>
      for {
        userConfig <- user.userConfigurationStructured
      } yield userConfig.configurationOrDefaults
    }.getOrElse(UserConfiguration.default.configuration).map(configuration => Ok(toJson(configuration)))
  }

  def update = sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
    for {
      jsConfiguration <- request.body.asOpt[JsObject] ?~> "user.configuration.invalid"
      conf = jsConfiguration.fields.toMap
      _ <- userService.updateUserConfiguration(request.identity, UserConfiguration(conf))
    } yield {
      JsonOk(Messages("user.configuration.updated"))
    }
  }

  def readDataSet(organizationName: String, dataSetName: String) = sil.UserAwareAction.async { implicit request =>
    request.identity.toFox.flatMap { user =>
      for {
        configurationJson: JsValue <- userDataSetConfigurationDAO.findOneForUserAndDataset(user._id, dataSetName)
      } yield DataSetConfiguration(configurationJson.validate[Map[String, JsValue]].getOrElse(Map.empty))
    }.orElse(
        for {
          dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)(GlobalAccessContext)
          config <- dataSet.defaultConfiguration
        } yield config
      )
      .getOrElse(dataSetConfigurationDefaults.constructInitialDefault(List()))
      .map(configuration => Ok(toJson(dataSetConfigurationDefaults.configurationOrDefaults(configuration))))
  }

  def updateDataSet(organizationName: String, dataSetName: String) =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        jsConfiguration <- request.body.asOpt[JsObject] ?~> "user.configuration.dataset.invalid"
        conf = jsConfiguration.fields.toMap
        _ <- userService.updateDataSetConfiguration(request.identity, dataSetName, DataSetConfiguration(conf))
      } yield {
        JsonOk(Messages("user.configuration.dataset.updated"))
      }
    }

  def readDataSetDefault(organizationName: String, dataSetName: String) = sil.SecuredAction.async { implicit request =>
    dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization).flatMap { dataSet: DataSet =>
      dataSet.defaultConfiguration match {
        case Some(c) => Fox.successful(Ok(toJson(dataSetConfigurationDefaults.configurationOrDefaults(c))))
        case _ =>
          dataSetConfigurationDefaults
            .constructInitialDefault(dataSet)
            .map(c => Ok(toJson(dataSetConfigurationDefaults.configurationOrDefaults(c))))
      }
    }
  }

  def updateDataSetDefault(organizationName: String, dataSetName: String) =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        dataset <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization) ?~> "dataset.notFound"
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOfOrg(request.identity, dataset._organization)) ?~> "notAllowed"
        jsConfiguration <- request.body.asOpt[JsObject] ?~> "user.configuration.dataset.invalid"
        conf = jsConfiguration.fields.toMap
        _ <- dataSetDAO.updateDefaultConfigurationByName(dataSetName, DataSetConfiguration(conf))
      } yield {
        JsonOk(Messages("user.configuration.dataset.updated"))
      }
    }
}
