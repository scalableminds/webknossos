package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.services.{DataStoreAccessTokenService, DatasetCache, UserAccessRequest}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import play.api.i18n.Messages
import play.api.mvc.{Action, AnyContent, Request}

import scala.collection.immutable.NumericRange
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
          rangeOpt <- parseRequestedRange(request)
          data <- requestedPath.readBytes(rangeOpt)
        } yield Ok(data)
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
        rangeOpt <- parseRequestedRange(request)
        data <- requestedPath.readBytes(rangeOpt)
      } yield Ok(data)
    }
  }

  private lazy val byteRangeRegex = """^bytes=(\d+)-(\d+)$""".r

  private def parseRequestedRange(request: Request[AnyContent])(
      implicit ec: ExecutionContext): Fox[Option[NumericRange[Long]]] =
    request.headers.get(RANGE) match {
      case None => Fox.successful(None)
      case Some(rangeHeader) =>
        rangeHeader match {
          case byteRangeRegex(start, end) => Fox.successful(Some(Range.Long(start.toLong, end.toLong, 1)))
          case _                          => Fox.failure("Invalid range header, only star-end byte ranges are supported.")
        }
    }

  private def validatePath(path: String): Fox[Unit] =
    for {
      _ <- Fox.fromBool(!path.contains("..")) ?~> "path must not contain “..”"
      _ <- Fox.fromBool(!path.startsWith("/")) ?~> "path must not start with “/”"
    } yield ()

}
