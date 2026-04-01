package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.{
  DSRemoteWebknossosClient,
  DataStoreAccessTokenService,
  UserAccessRequest
}
import com.scalableminds.webknossos.datastore.services.uploading.{
  CancelUploadInformation,
  ReserveUploadInformation,
  UploadDomain,
  UploadInformation,
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

  def reserveUpload(uploadDomain: String): Action[ReserveUploadInformation] =
    Action.async(validateJson[ReserveUploadInformation]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDatasets(request.body.organization)) {
        for {
          uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
          isKnownUpload <- uploadService.isKnownUpload(request.body.uploadId, uploadDomainValidated)
          _ <- if (!isKnownUpload) {
            for {
              reserveUploadAdditionalInfo <- dsRemoteWebknossosClient.reserveDataSourceUpload(request.body) ?~> "dataset.upload.validation.failed"
              _ <- uploadService.reserveUpload(request.body,
                                               reserveUploadAdditionalInfo.newDatasetId,
                                               reserveUploadAdditionalInfo.directoryName,
                                               uploadDomainValidated)
            } yield ()
          } else Fox.successful(())
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

  def finishUpload(uploadDomain: String): Action[UploadInformation] = Action.async(validateJson[UploadInformation]) {
    implicit request =>
      log(Some(slackNotificationService.noticeFailedUploadRequest)) {
        logTime(slackNotificationService.noticeSlowRequest) {
          for {
            uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
            datasetId <- uploadService
              .getDatasetIdByUploadId(request.body.uploadId, uploadDomainValidated) ?~> s"Cannot find running upload with upload id ${request.body.uploadId}"
            response <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
              for {
                // TODO other domains
                _ <- uploadService.finishDatasetUpload(request.body, datasetId) ?~> Messages(
                  "dataset.upload.finishFailed",
                  datasetId)
              } yield Ok(Json.obj("newDatasetId" -> datasetId))
            }
          } yield response
        }
      }
  }

  def cancelUpload(uploadDomain: String): Action[CancelUploadInformation] =
    Action.async(validateJson[CancelUploadInformation]) { implicit request =>
      for {
        uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
        datasetIdFox = uploadService.isKnownUpload(request.body.uploadId, uploadDomainValidated).flatMap {
          case false => Fox.failure("dataset.upload.validation.failed")
          case true  => uploadService.getDatasetIdByUploadId(request.body.uploadId, uploadDomainValidated)
        }
        result <- datasetIdFox.flatMap { datasetId =>
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.deleteDataset(datasetId)) {
            for {
              _ <- dsRemoteWebknossosClient.deleteDataset(datasetId) ?~> "dataset.delete.webknossos.failed"
              _ <- uploadService.cancelUpload(request.body, uploadDomainValidated) ?~> "Could not cancel the upload."
            } yield Ok
          }
        }
      } yield result
    }

}
