package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.Msg
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.services.{
  DSRemoteWebknossosClient,
  DataStoreAccessTokenService,
  UserAccessRequest
}
import com.scalableminds.webknossos.datastore.services.uploading.{
  AttachmentUploadInfo,
  CancelUploadInformation,
  DatasetUploadInfo,
  MagUploadInfo,
  UploadDomain,
  UploadService
}
import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService
import play.api.data.Form
import play.api.data.Forms.tuple
import play.api.libs.Files
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}
import play.api.data.Forms.{longNumber, nonEmptyText, number}

import java.io.File
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class UploadController @Inject() (
    accessTokenService: DataStoreAccessTokenService,
    uploadService: UploadService,
    dsRemoteWebknossosClient: DSRemoteWebknossosClient,
    slackNotificationService: DSSlackNotificationService
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller {

  override def allowRemoteOrigin: Boolean = true

  def reserveDatasetUpload(): Action[DatasetUploadInfo] =
    Action.async(validateJson[DatasetUploadInfo]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDatasets(request.body.organizationId)
      ) {
        for {
          isKnownUpload <- uploadService.isKnownUpload(request.body.resumableUploadInfo.uploadId, UploadDomain.dataset)
          _ <- Fox.runIf(!isKnownUpload) {
            for {
              reserveUploadAdditionalInfo <- dsRemoteWebknossosClient.reserveDatasetUpload(
                request.body
              ) ?~> Msg.Dataset.Upload.validationFailed
              _ <- uploadService.reserveDatasetUpload(
                request.body,
                reserveUploadAdditionalInfo.newDatasetId,
                reserveUploadAdditionalInfo.directoryName
              )
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
          _ <- Fox.runIf(!isKnownUpload) {
            for {
              reserveUploadAdditionalInfo <- dsRemoteWebknossosClient.reserveMagUpload(
                request.body
              ) ?~> Msg.Dataset.Upload.validationFailed
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
          isKnownUpload <- uploadService.isKnownUpload(
            request.body.resumableUploadInfo.uploadId,
            UploadDomain.attachment
          )
          _ <- Fox.runIf(!isKnownUpload) {
            for {
              reserveUploadAdditionalInfo <- dsRemoteWebknossosClient.reserveAttachmentUpload(
                request.body
              ) ?~> "dataset.upload.validation.failed"
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
          _ <- Fox.fromBool(
            uploadDomainValidated == UploadDomain.dataset
          ) ?~> "Listing unfinished downloads is only supported for datasets."
          unfinishedUploads <- dsRemoteWebknossosClient.getUnfinishedUploadsForUser(organizationName)
          unfinishedUploadsWithUploadIds <- Fox.fromFuture(
            uploadService.enrichUnfinishedUploadInfoWithUploadIds(unfinishedUploads)
          )
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
          )
        ).fill((-1, -1, -1, -1, ""))

        uploadForm
          .bindFromRequest(request.body.dataParts)
          .fold(
            hasErrors = formWithErrors => Fox.successful(JsonBadRequest(formWithErrors.errors.head.message)),
            success = { case (chunkNumber, chunkSize, currentChunkSize, totalChunkCount, uploadFileId) =>
              val uploadId = uploadService.extractDatasetUploadId(uploadFileId)
              for {
                uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
                datasetId <- uploadService.getDatasetIdByUploadId(
                  uploadId,
                  uploadDomainValidated
                ) ?~> Msg.Dataset.Upload.noSuchUpload(uploadId, uploadDomain)
                result <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
                  for {
                    isKnownUpload <- uploadService.isKnownUploadByFileId(uploadFileId, uploadDomainValidated)
                    _ <- Fox.fromBool(isKnownUpload) ?~> "dataset.upload.validation.failed"
                    chunkFile <- request.body.file("file").toFox ?~> "zip.file.notFound"
                    _ <- uploadService.handleUploadChunk(
                      uploadFileId,
                      chunkSize,
                      currentChunkSize,
                      totalChunkCount,
                      chunkNumber,
                      new File(chunkFile.ref.path.toString),
                      uploadDomainValidated
                    )
                  } yield Ok
                }
              } yield result
            }
          )
      }
    }

  def testChunk(resumableChunkNumber: Int, resumableIdentifier: String, uploadDomain: String): Action[AnyContent] =
    Action.async { implicit request =>
      val uploadId = uploadService.extractDatasetUploadId(resumableIdentifier)
      for {
        uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
        datasetId <- uploadService.getDatasetIdByUploadId(uploadId, uploadDomainValidated) ?~> Msg.Dataset.Upload
          .noSuchUpload(uploadId, uploadDomain)
        result <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
          for {
            isKnownUpload <- uploadService.isKnownUploadByFileId(resumableIdentifier, uploadDomainValidated)
            _ <- Fox.fromBool(isKnownUpload) ?~> Msg.Dataset.Upload.noSuchUpload(uploadId, uploadDomain)
            isPresent <- uploadService.isChunkPresent(resumableIdentifier, resumableChunkNumber, uploadDomainValidated)
          } yield if (isPresent) Ok else NoContent
        }
      } yield result
    }

  def finishUpload(uploadDomain: String, uploadId: String): Action[AnyContent] = Action.async { implicit request =>
    log(Some(slackNotificationService.noticeFailedUploadRequest)) {
      logTime(slackNotificationService.noticeSlowRequest) {
        for {
          uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
          datasetId <- uploadService.getDatasetIdByUploadId(uploadId, uploadDomainValidated) ?~> Msg.Dataset.Upload
            .noSuchUpload(uploadId, uploadDomain)
          response <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
            for {
              _ <- (uploadDomainValidated match {
                case UploadDomain.dataset    => uploadService.finishDatasetUpload(uploadId, datasetId)
                case UploadDomain.mag        => uploadService.finishMagUpload(uploadId, datasetId)
                case UploadDomain.attachment => uploadService.finishAttachmentUpload(uploadId, datasetId)
              }) ?~> Msg.Dataset.Upload.finishFailed(datasetId, uploadDomain)
            } yield Ok(Json.obj("datasetId" -> datasetId))
          }
        } yield response
      }
    }
  }

  def cancelUpload(uploadDomain: String, uploadId: String): Action[CancelUploadInformation] =
    Action.async(validateJson[CancelUploadInformation]) { implicit request =>
      for {
        uploadDomainValidated <- UploadDomain.fromString(uploadDomain).toFox
        _ <- Fox.fromBool(
          uploadDomainValidated == UploadDomain.dataset
        ) ?~> "Cancel upload is only supported for datasets."
        datasetIdFox = uploadService.isKnownUpload(uploadId, uploadDomainValidated).flatMap {
          case false => Fox.failure(Msg.Dataset.Upload.noSuchUpload(request.body.uploadId, uploadDomain))
          case true  => uploadService.getDatasetIdByUploadId(uploadId, uploadDomainValidated)
        }
        result <- datasetIdFox.flatMap { datasetId =>
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.deleteDataset(datasetId)) {
            for {
              _ <- dsRemoteWebknossosClient.deleteDataset(datasetId) ?~> Msg.Dataset.Delete.webknossosFailed
              _ <- uploadService.cancelUpload(uploadDomainValidated, uploadId) ?~> "Could not cancel the upload."
            } yield Ok
          }
        }
      } yield result
    }

}
