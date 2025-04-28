package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId

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
      configuration <- request.body.asOpt[JsObject].toFox ?~> "user.configuration.invalid"
      _ <- userService.updateUserConfiguration(request.identity, configuration)
    } yield JsonOk(Messages("user.configuration.updated"))
  }

  def readDatasetViewConfiguration(datasetId: ObjectId, sharingToken: Option[String]): Action[List[String]] =
    sil.UserAwareAction.async(validateJson[List[String]]) { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        configuration <- request.identity.toFox
          .flatMap(user =>
            datasetConfigurationService.getDatasetViewConfigurationForUserAndDataset(request.body, user, datasetId)(
              GlobalAccessContext))
          .orElse(
            datasetConfigurationService.getDatasetViewConfigurationForDataset(request.body, datasetId)(ctx)
          )
          .getOrElse(Map.empty)
      } yield Ok(Json.toJson(configuration))
    }

  def updateDatasetViewConfiguration(datasetId: ObjectId): Action[JsValue] =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        jsConfiguration <- request.body.asOpt[JsObject].toFox ?~> "user.configuration.dataset.invalid"
        conf = jsConfiguration.fields.toMap
        datasetConf = conf - "layers"
        layerConf = conf.get("layers")
        _ <- userService.updateDatasetViewConfiguration(request.identity, datasetId, datasetConf, layerConf)
      } yield JsonOk(Messages("user.configuration.dataset.updated"))
    }

  def readDatasetAdminViewConfiguration(datasetId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        configuration <- datasetConfigurationService.getCompleteAdminViewConfiguration(datasetId)
      } yield Ok(Json.toJson(configuration))
    }

  def updateDatasetAdminViewConfiguration(datasetId: ObjectId): Action[JsValue] =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext)
        _ <- datasetService.isEditableBy(dataset, Some(request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        jsObject <- request.body.asOpt[JsObject].toFox ?~> "user.configuration.dataset.invalid"
        _ <- datasetConfigurationService.updateAdminViewConfigurationFor(dataset, jsObject.fields.toMap)
      } yield JsonOk(Messages("user.configuration.dataset.updated"))
    }
}
