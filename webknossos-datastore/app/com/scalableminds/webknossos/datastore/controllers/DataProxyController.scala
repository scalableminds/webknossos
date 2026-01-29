package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datavault.ByteRange
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerAttachments, UsableDataSource}
import com.scalableminds.webknossos.datastore.services.{DataStoreAccessTokenService, DatasetCache, UserAccessRequest}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import play.api.http.Writeable
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, ResponseHeader, Result}

import scala.concurrent.ExecutionContext

class DataProxyController @Inject()(accessTokenService: DataStoreAccessTokenService,
                                    dataVaultService: DataVaultService,
                                    datasetCache: DatasetCache)(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def proxyMag(datasetId: ObjectId, dataLayerName: String, mag: String, path: String): Action[AnyContent] =
    Action.async { implicit request =>
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
          byteRange <- ByteRange.fromRequest(request)
          data <- requestedPath.readBytes(byteRange)
        } yield resultWithStatus(byteRange.successResponseCode, data).withHeaders(ACCEPT_RANGES -> "bytes")
      }
    }

  def proxyAttachment(datasetId: ObjectId,
                      dataLayerName: String,
                      attachmentName: String,
                      path: String): Action[AnyContent] = Action.async { implicit request =>
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
        byteRange <- ByteRange.fromRequest(request)
        data <- requestedPath.readBytes(byteRange)
      } yield resultWithStatus(byteRange.successResponseCode, data).withHeaders(ACCEPT_RANGES -> "bytes")
    }
  }

  def proxyDatasource(datasetId: ObjectId): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        dataSource <- datasetCache.getById(datasetId) ?~> "dataSource.notFound" ~> NOT_FOUND
        dataSourceWithAdaptedPaths = adaptPathsForDataSource(dataSource)
      } yield Ok(Json.toJson(dataSourceWithAdaptedPaths))
    }
  }

  private def adaptPathsForDataSource(dataSource: UsableDataSource) =
    dataSource.copy(
      dataLayers = dataSource.dataLayers.map(
        layer =>
          layer.mapped(magMapping = mag => adaptPathForMag(mag, layer.name),
                       attachmentMapping = attachments => adaptPathsForAttachments(attachments, layer.name)))
    )

  private def adaptPathForMag(mag: MagLocator, layerName: String): MagLocator =
    mag.copy(
      path = Some(UPath.fromStringUnsafe(s"./layers/$layerName/mags/${mag.mag.toMagLiteral(allowScalar = true)}")))

  private def adaptPathsForAttachments(attachments: DataLayerAttachments, layerName: String): DataLayerAttachments =
    attachments.mapped(
      attachment =>
        attachment.copy(
          path = UPath.fromStringUnsafe(s"./layers/$layerName/attachments/${attachment.name}")
      ))

  private def validatePath(path: String): Fox[Unit] =
    for {
      _ <- Fox.fromBool(!path.contains("..")) ?~> "path must not contain “..”"
      _ <- Fox.fromBool(!path.startsWith("/")) ?~> "path must not start with “/”"
    } yield ()

  private def resultWithStatus[C](statusCode: Int, content: C)(implicit writeable: Writeable[C]): Result =
    Result(
      ResponseHeader(statusCode),
      writeable.toEntity(content)
    )

}
