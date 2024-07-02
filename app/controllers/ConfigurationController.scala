package controllers

import play.silhouette.api.Silhouette
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

  def readDatasetViewConfiguration(organizationName: String,
                                   datasetName: String,
                                   sharingToken: Option[String]): Action[List[String]] =
    sil.UserAwareAction.async(validateJson[List[String]]) { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      request.identity.toFox
        .flatMap(
          user =>
            datasetConfigurationService
              .getDatasetViewConfigurationForUserAndDataset(request.body, user, datasetName, organizationName)(
                GlobalAccessContext))
        .orElse(
          datasetConfigurationService.getDatasetViewConfigurationForDataset(request.body,
                                                                            datasetName,
                                                                            organizationName)(ctx)
        )
        .getOrElse(Map.empty)
        .map(configuration => Ok(Json.toJson(configuration)))
    }

  def updateDatasetViewConfiguration(organizationName: String, datasetName: String): Action[JsValue] =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        jsConfiguration <- request.body.asOpt[JsObject] ?~> "user.configuration.dataset.invalid"
        conf = jsConfiguration.fields.toMap
        datasetConf = conf - "layers"
        layerConf = conf.get("layers")
        _ <- userService.updateDatasetViewConfiguration(request.identity,
                                                        datasetName,
                                                        organizationName,
                                                        datasetConf,
                                                        layerConf)
      } yield JsonOk(Messages("user.configuration.dataset.updated"))
    }

  def readDatasetAdminViewConfiguration(organizationName: String, datasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      datasetConfigurationService
        .getCompleteAdminViewConfiguration(datasetName, organizationName)
        .map(configuration => Ok(Json.toJson(configuration)))
    }

  def updateDatasetAdminViewConfiguration(organizationName: String, datasetName: String): Action[JsValue] =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        dataset <- datasetDAO.findOneByNameAndOrganizationName(datasetName, organizationName) ?~> "dataset.notFound" ~> NOT_FOUND
        _ <- datasetService.isEditableBy(dataset, Some(request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        jsObject <- request.body.asOpt[JsObject].toFox ?~> "user.configuration.dataset.invalid"
        p_ <- datasetConfigurationService.updateAdminViewConfigurationFor(dataset, jsObject.fields.toMap)
      } yield JsonOk(Messages("user.configuration.dataset.updated"))
    }
}
