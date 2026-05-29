package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox

import javax.inject.Inject
import models.dataset.{DatasetDAO, DatasetService}
import models.configuration.DatasetConfigurationService
import models.user.{UserKeyboardShortcutsConfigsDAO, UserService}
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{URLSharing, WkEnv}

import scala.concurrent.ExecutionContext

class ConfigurationController @Inject()(
    userService: UserService,
    datasetService: DatasetService,
    datasetDAO: DatasetDAO,
    datasetConfigurationService: DatasetConfigurationService,
    userKeyboardShortcutsConfigsDAO: UserKeyboardShortcutsConfigsDAO,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def read: Action[AnyContent] = sil.UserAwareAction { implicit request =>
    val config = request.identity.map(_.userConfiguration).getOrElse(Json.obj())
    addNoCacheHeaderFallback(Ok(Json.toJson(config)))
  }

  def update: Action[JsValue] = sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
    for {
      configuration <- request.body.asOpt[JsObject].toFox ?~> Msg.User.Configuration.invalid
      _ <- userService.updateUserConfiguration(request.identity, configuration)
    } yield JsonOk(Msg.User.Configuration.updateSuccess)
  }

  def readKeyboardShortcutsConfig: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      shortcuts <- request.identity
        .map(u => userKeyboardShortcutsConfigsDAO.findOneForUser(u._multiUser))
        .getOrElse(Fox.successful(Json.obj()))
    } yield addNoCacheHeaderFallback(Ok(shortcuts))
  }

  def updateKeyboardShortcutsConfig(): Action[JsValue] = sil.SecuredAction.async(parse.json(maxLength = 204800)) {
    implicit request =>
      for {
        shortcuts <- request.body.asOpt[JsObject].toFox ?~> Msg.User.Configuration.invalidKeyboardShortcutsConfig
        _ <- userKeyboardShortcutsConfigsDAO.updateForUser(request.identity._multiUser, shortcuts)
      } yield JsonOk(Msg.User.Configuration.updatedKeyboardShortcutsConfig)
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
        jsConfiguration <- request.body.asOpt[JsObject].toFox ?~> Msg.User.Configuration.invalidForDataset
        conf = jsConfiguration.fields.toMap
        datasetConf = conf - "layers"
        layerConf = conf.get("layers")
        _ <- userService.updateDatasetViewConfiguration(request.identity, datasetId, datasetConf, layerConf)
      } yield JsonOk(Msg.User.Configuration.updateSuccessForDataset)
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
        _ <- datasetService.isEditableBy(dataset, Some(request.identity)) ?~> Msg.notAllowed ~> FORBIDDEN
        jsObject <- request.body.asOpt[JsObject].toFox ?~> Msg.User.Configuration.invalidForDataset
        _ <- datasetConfigurationService.updateAdminViewConfigurationFor(dataset, jsObject.fields.toMap)
      } yield JsonOk(Msg.User.Configuration.updateSuccessForDataset)
    }
}
