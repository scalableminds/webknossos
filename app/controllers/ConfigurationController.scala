package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import models.binary.{DataSetDAO, DataSetService}
import models.configuration.{DataSetConfigurationService, UserConfiguration}
import models.user.UserService
import oxalis.security.{URLSharing, WkEnv}
import play.api.i18n.Messages
import play.api.libs.json.JsObject
import play.api.libs.json.Json._
import play.api.mvc.PlayBodyParsers
import javax.inject.Inject

import scala.concurrent.ExecutionContext

class ConfigurationController @Inject()(
    userService: UserService,
    dataSetService: DataSetService,
    dataSetDAO: DataSetDAO,
    dataSetConfigurationService: DataSetConfigurationService,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
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

  def readDataSetViewConfiguration(organizationName: String, dataSetName: String, sharingToken: Option[String]) =
    sil.UserAwareAction.async(validateJson[List[String]]) { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      request.identity.toFox
        .flatMap(
          user =>
            dataSetConfigurationService
              .getDataSetViewConfigurationForUserAndDataset(request.body, user, dataSetName, organizationName)(
                GlobalAccessContext))
        .orElse(
          dataSetConfigurationService.getDataSetViewConfigurationForDataset(request.body,
                                                                            dataSetName,
                                                                            organizationName)(ctx)
        )
        .getOrElse(Map.empty)
        .map(configuration => Ok(toJson(configuration)))
    }

  def updateDataSetViewConfiguration(organizationName: String, dataSetName: String) =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        jsConfiguration <- request.body.asOpt[JsObject] ?~> "user.configuration.dataset.invalid"
        conf = jsConfiguration.fields.toMap
        dataSetConf = conf - "layers"
        layerConf = conf.get("layers")
        _ <- userService.updateDataSetViewConfiguration(request.identity,
                                                        dataSetName,
                                                        organizationName,
                                                        dataSetConf,
                                                        layerConf)
      } yield {
        JsonOk(Messages("user.configuration.dataset.updated"))
      }
    }

  def readDataSetAdminViewConfiguration(organizationName: String, dataSetName: String) = sil.SecuredAction.async {
    implicit request =>
      dataSetConfigurationService
        .getCompleteAdminViewConfiguration(dataSetName, organizationName)
        .map(configuration => Ok(toJson(configuration)))
  }

  def updateDataSetAdminViewConfiguration(organizationName: String, dataSetName: String) =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        dataset <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName) ?~> "dataset.notFound" ~> NOT_FOUND
        _ <- dataSetService.isEditableBy(dataset, Some(request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        jsObject <- request.body.asOpt[JsObject].toFox ?~> "user.configuration.dataset.invalid"
        _ <- dataSetConfigurationService.updateAdminViewConfigurationFor(dataset, jsObject.fields.toMap)
      } yield {
        JsonOk(Messages("user.configuration.dataset.updated"))
      }
    }
}
