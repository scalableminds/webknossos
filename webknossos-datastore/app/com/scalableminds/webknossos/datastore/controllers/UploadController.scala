package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.{
  DSRemoteWebknossosClient,
  DataStoreAccessTokenService,
  UserAccessRequest
}
import com.scalableminds.webknossos.datastore.services.uploading.{
  AttachmentUploadInfo,
  DatasetUploadInfo,
  MagUploadInfo,
  UploadDomain,
  UploadService
}
import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService
import play.api.data.Form
import play.api.data.Forms.tuple
import play.api.i18n.Messages
import play.api.libs.Files
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}
import play.api.data.Forms.{longNumber, nonEmptyText, number}

import java.io.File
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class UploadController @Inject()(
    accessTokenService: DataStoreAccessTokenService,
    uploadService: UploadService,
    dsRemoteWebknossosClient: DSRemoteWebknossosClient,
    slackNotificationService: DSSlackNotificationService)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller {

  def reserveDatasetUpload(): Action[DatasetUploadInfo] =
    Action.async(validateJson[DatasetUploadInfo]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDatasets(request.body.organizationId)) {
        for {
          isKnownUpload <- uploadService.isKnownUpload(request.body.resumableUploadInfo.uploadId, UploadDomain.dataset)
          _ <- Fox.runIf(!isKnownUpload) {
            for {
              reserveUploadAdditionalInfo <- dsRemoteWebknossosClient.reserveDatasetUpload(request.body) ?~> "dataset.upload.validation.failed"
              _ <- uploadService.reserveDatasetUpload(request.body,
                                                      reserveUploadAdditionalInfo.newDatasetId,
                                                      reserveUploadAdditionalInfo.directoryName)
            } yield ()
          }
        } yield Ok
      }
    }

  def reserveMagUpload(): Action[MagUploadInfo] =
    Action.async(validateJson[MagUploadInfo]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(request.body.datasetId)) {
        for {
          isKnownUpload <- uploadService.isKnownUpload(request.body.resumableUploadInfo.uploadId, UploadDomain.mag)
          _ <- Fox.runIf(isKnownUpload) {
            for {
              reserveUploadAdditionalInfo <- dsRemoteWebknossosClient.reserveMagUpload(request.body) ?~> "dataset.upload.validation.failed"
              _ <- uploadService.reserveMagUpload(request.body, reserveUploadAdditionalInfo.dataSourceId)
            } yield ()
          }
        } yield Ok
      }
    }

  def reserveAttachmentUpload(): Action[AttachmentUploadInfo] =
    Action.async(validateJson[AttachmentUploadInfo]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(request.body.datasetId)) {
        for {
          isKnownUpload <- uploadService.isKnownUpload(request.body.resumableUploadInfo.uploadId,
                                                       UploadDomain.attachment)
          _ <- Fox.runIf(isKnownUpload) {
            for {
              reserveUploadAdditionalInfo <- dsRemoteWebknossosClient.reserveAttachmentUpload(request.body) ?~> "dataset.upload.validation.failed"
              _ <- uploadService.reserveAttachmentUpload(request.body, reserveUploadAdditionalInfo.dataSourceId)
            } yield ()
          }
        } yield Ok
      }
    }

  def getUnfinishedUploads(organizationName: String, uploadDomain: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.administrateDatasets(organizationName)) {
        for {
          uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
          _ <- Fox.fromBool(uploadDomainValidated == UploadDomain.dataset) ?~> "Listing unfinished downloads is only supported for datasets."
          unfinishedUploads <- dsRemoteWebknossosClient.getUnfinishedUploadsForUser(organizationName)
          unfinishedUploadsWithUploadIds <- Fox.fromFuture(
            uploadService.enrichUnfinishedUploadInfoWithUploadIds(unfinishedUploads))
          unfinishedUploadsWithUploadIdsWithoutDataSourceId = unfinishedUploadsWithUploadIds.map(_.withoutDataSourceId)
        } yield Ok(Json.toJson(unfinishedUploadsWithUploadIdsWithoutDataSourceId))
      }
    }

  /* Upload a byte chunk for a new dataset
  Expects:
    - As file attachment: A raw byte chunk of the dataset
    - As form parameter:
    - name (string): dataset name
    - owningOrganization (string): owning organization name
    - resumableChunkNumber (int): chunk index
    - resumableChunkSize (int): chunk size in bytes
    - resumableTotalChunks (string): total chunk count of the upload
    - totalFileCount (string): total file count of the upload
    - resumableIdentifier (string): identifier of the resumable upload and file ("{uploadId}/{filepath}")
    - As GET parameter:
    - token (string): datastore token identifying the uploading user
   */
  def uploadChunk(uploadDomain: String): Action[MultipartFormData[Files.TemporaryFile]] =
    Action.async(parse.multipartFormData) { implicit request =>
      log(Some(slackNotificationService.noticeFailedUploadRequest)) {
        val uploadForm = Form(
          tuple(
            "resumableChunkNumber" -> number,
            "resumableChunkSize" -> number,
            "resumableCurrentChunkSize" -> number,
            "resumableTotalChunks" -> longNumber,
            "resumableIdentifier" -> nonEmptyText
          )).fill((-1, -1, -1, -1, ""))

        uploadForm
          .bindFromRequest(request.body.dataParts)
          .fold(
            hasErrors = formWithErrors => Fox.successful(JsonBadRequest(formWithErrors.errors.head.message)),
            success = {
              case (chunkNumber, chunkSize, currentChunkSize, totalChunkCount, uploadFileId) =>
                for {
                  uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
                  datasetId <- uploadService.getDatasetIdByUploadId(
                    uploadService.extractDatasetUploadId(uploadFileId),
                    uploadDomainValidated) ?~> "dataset.upload.validation.failed"
                  result <- accessTokenService
                    .validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
                      for {
                        isKnownUpload <- uploadService.isKnownUploadByFileId(uploadFileId, uploadDomainValidated)
                        _ <- Fox.fromBool(isKnownUpload) ?~> "dataset.upload.validation.failed"
                        chunkFile <- request.body.file("file").toFox ?~> "zip.file.notFound"
                        _ <- uploadService.handleUploadChunk(uploadFileId,
                                                             chunkSize,
                                                             currentChunkSize,
                                                             totalChunkCount,
                                                             chunkNumber,
                                                             new File(chunkFile.ref.path.toString),
                                                             uploadDomainValidated)
                      } yield Ok
                    }
                } yield result
            }
          )
      }
    }

  def testChunk(resumableChunkNumber: Int, resumableIdentifier: String, uploadDomain: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
        datasetId <- uploadService.getDatasetIdByUploadId(uploadService.extractDatasetUploadId(resumableIdentifier),
                                                          uploadDomainValidated) ?~> "dataset.upload.validation.failed"
        result <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
          for {
            isKnownUpload <- uploadService.isKnownUploadByFileId(resumableIdentifier, uploadDomainValidated)
            _ <- Fox.fromBool(isKnownUpload) ?~> "dataset.upload.validation.failed"
            isPresent <- uploadService.isChunkPresent(resumableIdentifier, resumableChunkNumber, uploadDomainValidated)
          } yield if (isPresent) Ok else NoContent
        }
      } yield result
    }

  // TODO legacy: still needs uploadId as body
  def finishUpload(uploadDomain: String, uploadId: String): Action[AnyContent] = Action.async { implicit request =>
    log(Some(slackNotificationService.noticeFailedUploadRequest)) {
      logTime(slackNotificationService.noticeSlowRequest) {
        for {
          uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
          datasetId <- uploadService
            .getDatasetIdByUploadId(uploadId, uploadDomainValidated) ?~> s"Cannot find running upload with upload id $uploadId"
          response <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
            for {
              _ <- (uploadDomainValidated match {
                case UploadDomain.dataset    => uploadService.finishDatasetUpload(uploadId, datasetId)
                case UploadDomain.mag        => uploadService.finishMagUpload(uploadId, datasetId)
                case UploadDomain.attachment => uploadService.finishAttachmentUpload(uploadId, datasetId)
              }) ?~> Messages("dataset.upload.finishFailed", datasetId)
            } yield Ok(Json.obj("datasetId" -> datasetId)) // TODO legacy needs to return this as "newDatasetid"
          }
        } yield response
      }
    }
  }

  // TODO legacy route needs to take uploadId as body
  def cancelUpload(uploadDomain: String, uploadId: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
      _ <- Fox
        .fromBool(uploadDomainValidated == UploadDomain.dataset) ?~> "Cancel upload is only supported for datasets."
      datasetIdFox = uploadService.isKnownUpload(uploadId, uploadDomainValidated).flatMap {
        case false => Fox.failure("dataset.upload.validation.failed")
        case true  => uploadService.getDatasetIdByUploadId(uploadId, uploadDomainValidated)
      }
      result <- datasetIdFox.flatMap { datasetId =>
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.deleteDataset(datasetId)) {
          for {
            _ <- dsRemoteWebknossosClient.deleteDataset(datasetId) ?~> "dataset.delete.webknossos.failed"
            _ <- uploadService.cancelUpload(uploadDomainValidated, uploadId) ?~> "Could not cancel the upload."
          } yield Ok
        }
      }
    } yield result
  }

}
