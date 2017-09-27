/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.braingames.binary.models.datasource.{DataLayerLike => DataLayer}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.binary._
import models.tracing.volume.VolumeTracingDAO
import models.user.User
import oxalis.security.silhouetteOxalis.{UserAwareAction, UserAwareRequest, SecuredRequest, SecuredAction}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.api.mvc.Action

class DataTokenController @Inject()(val messagesApi: MessagesApi) extends Controller{

  private def ensureAccessToLayer(
    dataSet: DataSet,
    dataLayerName: String)(implicit ctx: DBAccessContext): Fox[Boolean] = {

    dataSet.dataSource.toUsable.flatMap(_.getDataLayer(dataLayerName)).toFox
      .orElse(VolumeTracingDAO.findOneByVolumeTracingLayerName(dataLayerName))
      .map(_ => true).orElse(false)
  }

  def generateToken(dataSetNameOpt: Option[String], dataLayerName: Option[String]) = UserAwareAction.async {
    implicit request =>
      dataSetNameOpt match {
        case Some(dataSetName) =>
          generateUserAndDataSetToken(dataSetName, dataLayerName: Option[String], request.identity)
        case _ =>
          generateUserToken(request.identity)
      }
  }

  def generateUserAndDataSetToken(
    dataSetName: String,
    dataLayerNameOpt: Option[String],
    user: Option[User])(implicit ctx: DBAccessContext) = {

      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        dataLayerName <- dataLayerNameOpt.toFox ?~> Messages("dataLayer.notFound", "")
        _ <- ensureAccessToLayer(dataSet, dataLayerName) ?~> Messages("dataLayer.forbidden") ~> FORBIDDEN
        token <- DataTokenService.generate(user, Some(dataSetName), Some(dataLayerName)) ?~> Messages("dataToken.creationFailed")
      } yield {
        Ok(Json.toJson(token))
      }
  }

  def generateUserToken(userOpt: Option[User])(implicit ctx: DBAccessContext) = {
    for {
      token <- DataTokenService.generate(userOpt, None, None) ?~> Messages("dataToken.creationFailed")
    } yield {
      Ok(Json.toJson(token))
    }
  }

  def validateUserAndDataSetToken(token: String, dataSetName: String, dataLayerName: String) = Action.async {
    implicit request =>
      DataTokenService.validate(token, dataSetName, dataLayerName).map {
        case true  =>
          Ok
        case false =>
          Forbidden
      }
  }

  def validateDataSetToken(dataSetToken: String, dataSetName: String) = Action.async { implicit request =>
    DataTokenService.validateDataSetToken(dataSetToken, dataSetName).map {
      case true  =>
        Ok
      case false =>
        Forbidden
    }
  }

}
