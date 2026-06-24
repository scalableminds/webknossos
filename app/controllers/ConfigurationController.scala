package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox

import javax.inject.Inject
import models.dataset.{DatasetDAO, DatasetService}
import models.configuration.DatasetConfigurationService
import models.user.{UserKeyboardShortcutsConfigsDAO, UserService}
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{URLSharing, WkEnv}

import scala.concurrent.ExecutionContext

class ConfigurationController @Inject() (
    userService: UserService,
    datasetService: DatasetService,
    datasetDAO: DatasetDAO,
    datasetConfigurationService: DatasetConfigurationService,
    userKeyboardShortcutsConfigsDAO: UserKeyboardShortcutsConfigsDAO,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def read: Action[AnyContent] = sil.UserAwareAction { implicit request =>
    val config = request.identity.map(_.userConfiguration).getOrElse(Json.obj())
    addNoCacheHeaderFallback(Ok(Json.toJson(config)))
  }

  def update: Action[JsObject] = sil.SecuredAction.fox(validateJson[JsObject]) { implicit request =>
    for {
      _ <- userService.updateUserConfiguration(request.identity, request.body)
    } yield JsonOk(Msg.User.Configuration.updateSuccess)
  }

  def readKeyboardShortcutsConfig: Action[AnyContent] = sil.UserAwareAction.fox { implicit request =>
    for {
      shortcuts <- request.identity
        .map(u => userKeyboardShortcutsConfigsDAO.findOneForUser(u._multiUser))
        .getOrElse(Fox.successful(Json.obj()))
    } yield addNoCacheHeaderFallback(Ok(shortcuts))
  }

  def updateKeyboardShortcutsConfig(): Action[JsObject] = sil.SecuredAction.fox(validateJson[JsObject]) {
    implicit request =>
      for {
        _ <- userKeyboardShortcutsConfigsDAO.updateForMultiUser(request.identity._multiUser, request.body)
      } yield JsonOk(Msg.User.Configuration.updatedKeyboardShortcutsConfig)
  }

  def readDatasetViewConfiguration(datasetId: ObjectId, sharingToken: Option[String]): Action[List[String]] =
    sil.UserAwareAction.fox(validateJson[List[String]]) { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        configuration <- request.identity.toFox
          .flatMap(user =>
            datasetConfigurationService.getDatasetViewConfigurationForUserAndDataset(request.body, user, datasetId)(
              using GlobalAccessContext
            )
          )
          .orElse(
            datasetConfigurationService.getDatasetViewConfigurationForDataset(request.body, datasetId)(using ctx)
          )
          .getOrElse(Map.empty)
      } yield Ok(Json.toJson(configuration))
    }

  def updateDatasetViewConfiguration(datasetId: ObjectId): Action[JsObject] =
    sil.SecuredAction.fox(validateJson[JsObject]) { implicit request =>
      val conf = request.body.fields.toMap
      val datasetConf = conf - "layers"
      val layerConf = conf.get("layers")
      for {
        _ <- userService.updateDatasetViewConfiguration(request.identity, datasetId, datasetConf, layerConf)
      } yield JsonOk(Msg.User.Configuration.updateSuccessForDataset)
    }

  def readDatasetAdminViewConfiguration(datasetId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      for {
        configuration <- datasetConfigurationService.getCompleteAdminViewConfiguration(datasetId)
      } yield Ok(Json.toJson(configuration))
    }

  def updateDatasetAdminViewConfiguration(datasetId: ObjectId): Action[JsObject] =
    sil.SecuredAction.fox(validateJson[JsObject]) { implicit request =>
      for {
        dataset <- datasetDAO.findOne(datasetId)(using GlobalAccessContext)
        _ <- datasetService.isEditableBy(dataset, Some(request.identity)) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- datasetConfigurationService.updateAdminViewConfigurationFor(dataset, request.body.fields.toMap)
      } yield JsonOk(Msg.User.Configuration.updateSuccessForDataset)
    }
}
