package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.services.{DataStoreAccessTokenService, DatasetCache, UserAccessRequest}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import play.api.i18n.Messages
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class DataProxyController @Inject()(accessTokenService: DataStoreAccessTokenService,
                                    dataVaultService: DataVaultService,
                                    datasetCache: DatasetCache)(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def proxyMag(datasetId: ObjectId, dataLayerName: String, mag: String, path: String): Action[AnyContent] =
    Action.async { implicit request =>
      val requestedRange: Option[String] = request.headers.get(RANGE)
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          _ <- validatePath(path)
          magValidated <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Messages("dataLayer.invalidMag",
                                                                                             mag)
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages(
            "dataLayer.notFound",
            dataLayerName) ~> NOT_FOUND
          magLocator <- dataLayer.mags.find(_.mag == magValidated).toFox ?~> Messages("dataLayer.wrongMag",
                                                                                      dataLayerName,
                                                                                      mag) ~> NOT_FOUND
          magPath <- dataVaultService.vaultPathFor(magLocator, dataSource.id, dataLayerName)
          requestedPath = magPath / path
          data <- requestedPath.readBytes() // TODO range
        } yield Ok(data)
      }
    }

  def proxyAttachment(datasetId: ObjectId,
                      dataLayerName: String,
                      attachmentName: String,
                      path: String): Action[AnyContent] = Action.async { implicit request =>
    val requestedRange: Option[String] = request.headers.get(RANGE)
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        _ <- validatePath(path)
        (_, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Messages("dataLayer.notFound",
                                                                                           dataLayerName) ~> NOT_FOUND
        attachment <- dataLayer.allAttachments.find(_.name == attachmentName).toFox ?~> Messages(
          "dataLayer.wrongAttachment",
          dataLayerName,
          attachmentName) ~> NOT_FOUND
        attachmentPath <- dataVaultService.vaultPathFor(attachment)
        requestedPath = attachmentPath / path
        data <- requestedPath.readBytes() // TODO range
      } yield Ok(data)
    }
  }

  private def validatePath(path: String): Fox[Unit] =
    for {
      _ <- Fox.fromBool(!path.contains("..")) ?~> "path must not contain “..”"
      _ <- Fox.fromBool(!path.startsWith("/")) ?~> "path must not start with “/”"
    } yield ()

}
