package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import javax.inject.Inject
import models.dataset.{DatasetDAO, DatasetService}
import models.configuration.DatasetConfigurationService
import models.user.UserService
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{URLSharing, WkEnv}

import scala.concurrent.ExecutionContext

class ConfigurationController @Inject()(
    userService: UserService,
    datasetService: DatasetService,
    datasetDAO: DatasetDAO,
    datasetConfigurationService: DatasetConfigurationService,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def read: Action[AnyContent] = sil.UserAwareAction { implicit request =>
    val config = request.identity.map(_.userConfiguration).getOrElse(Json.obj())
    addNoCacheHeaderFallback(Ok(Json.toJson(config)))
  }

  def update: Action[JsValue] = sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
    for {
      configuration <- request.body.asOpt[JsObject] ?~> "user.configuration.invalid"
      _ <- userService.updateUserConfiguration(request.identity, configuration)
    } yield JsonOk(Messages("user.configuration.updated"))
  }

  def readDataSetViewConfiguration(organizationName: String,
                                   dataSetName: String,
                                   sharingToken: Option[String]): Action[List[String]] =
    sil.UserAwareAction.async(validateJson[List[String]]) { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      request.identity.toFox
        .flatMap(
          user =>
            datasetConfigurationService
              .getDataSetViewConfigurationForUserAndDataset(request.body, user, dataSetName, organizationName)(
                GlobalAccessContext))
        .orElse(
          datasetConfigurationService.getDatasetViewConfigurationForDataset(request.body,
                                                                            dataSetName,
                                                                            organizationName)(ctx)
        )
        .getOrElse(Map.empty)
        .map(configuration => Ok(Json.toJson(configuration)))
    }

  def updateDataSetViewConfiguration(organizationName: String, dataSetName: String): Action[JsValue] =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        jsConfiguration <- request.body.asOpt[JsObject] ?~> "user.configuration.dataset.invalid"
        conf = jsConfiguration.fields.toMap
        datasetConf = conf - "layers"
        layerConf = conf.get("layers")
        _ <- userService.updateDataSetViewConfiguration(request.identity,
                                                        dataSetName,
                                                        organizationName,
                                                        datasetConf,
                                                        layerConf)
      } yield JsonOk(Messages("user.configuration.dataset.updated"))
    }

  def readDataSetAdminViewConfiguration(organizationName: String, dataSetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      datasetConfigurationService
        .getCompleteAdminViewConfiguration(dataSetName, organizationName)
        .map(configuration => Ok(Json.toJson(configuration)))
    }

  def updateDataSetAdminViewConfiguration(organizationName: String, dataSetName: String): Action[JsValue] =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        dataset <- datasetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName) ?~> "dataset.notFound" ~> NOT_FOUND
        _ <- datasetService.isEditableBy(dataset, Some(request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        jsObject <- request.body.asOpt[JsObject].toFox ?~> "user.configuration.dataset.invalid"
        _ <- datasetConfigurationService.updateAdminViewConfigurationFor(dataset, jsObject.fields.toMap)
      } yield JsonOk(Messages("user.configuration.dataset.updated"))
    }
}
