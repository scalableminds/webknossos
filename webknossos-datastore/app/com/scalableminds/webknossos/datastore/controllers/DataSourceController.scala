package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{
  InboxDataSource,
  InboxDataSourceLike,
  UnusableInboxDataSource
}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.services._
import play.api.data.Form
import play.api.data.Forms.{longNumber, nonEmptyText, number, tuple}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}
import java.io.File

import io.swagger.annotations.{Api, ApiOperation, ApiResponse, ApiResponses}
import play.api.libs.Files

import scala.concurrent.ExecutionContext.Implicits.global

@Api(tags = Array("datastore"))
class DataSourceController @Inject()(
    dataSourceRepository: DataSourceRepository,
    dataSourceService: DataSourceService,
    remoteWebKnossosClient: DSRemoteWebKnossosClient,
    accessTokenService: DataStoreAccessTokenService,
    sampleDatasetService: SampleDataSourceService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    meshFileService: MeshFileService,
    uploadService: UploadService
)(implicit bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  @ApiOperation(hidden = true, value = "")
  def list(token: Option[String]): Action[AnyContent] = Action.async { implicit request =>
    {
      accessTokenService.validateAccessForSyncBlock(UserAccessRequest.listDataSources, token) {
        AllowRemoteOrigin {
          val ds = dataSourceRepository.findAll
          Ok(Json.toJson(ds))
        }
      }
    }
  }

  @ApiOperation(hidden = true, value = "")
  def read(token: Option[String],
           organizationName: String,
           dataSetName: String,
           returnFormatLike: Boolean): Action[AnyContent] =
    Action.async { implicit request =>
      {
        accessTokenService.validateAccessForSyncBlock(
          UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
          token) {
          AllowRemoteOrigin {
            val dsOption: Option[InboxDataSource] =
              dataSourceRepository.find(DataSourceId(dataSetName, organizationName))
            dsOption match {
              case Some(ds) =>
                val dslike: InboxDataSourceLike = ds
                if (returnFormatLike) Ok(Json.toJson(dslike))
                else Ok(Json.toJson(ds))
              case _ => Ok
            }
          }
        }
      }
    }

  @ApiOperation(hidden = true, value = "")
  def triggerInboxCheck(token: Option[String]): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(UserAccessRequest.administrateDataSources, token) {
      AllowRemoteOrigin {
        dataSourceService.checkInbox(verbose = true)
        Ok
      }
    }
  }

  @ApiOperation(hidden = true, value = "")
  def triggerInboxCheckBlocking(token: Option[String]): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.administrateDataSources, token) {
      AllowRemoteOrigin {
        for {
          _ <- dataSourceService.checkInbox(verbose = true)
        } yield Ok
      }
    }
  }

  @ApiOperation(
    value = """Upload a byte chunk for a new dataset
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
""",
    nickname = "datasetUploadChunk"
  )
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "Empty body, chunk was saved on the server"),
      new ApiResponse(code = 400, message = "Operation could not be performed. See JSON body for more information.")
    ))
  def uploadChunk(token: String): Action[MultipartFormData[Files.TemporaryFile]] =
    Action.async(parse.multipartFormData) { implicit request =>
      val uploadForm = Form(
        tuple(
          "name" -> nonEmptyText.verifying("dataSet.name.invalid", n => n.matches("[A-Za-z0-9_\\-]*")),
          "owningOrganization" -> nonEmptyText,
          "resumableChunkNumber" -> number,
          "resumableChunkSize" -> number,
          "resumableTotalChunks" -> longNumber,
          "totalFileCount" -> number,
          "resumableIdentifier" -> nonEmptyText
        )).fill(("", "", -1, -1, -1, -1, ""))

      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources, Some(token)) {
        AllowRemoteOrigin {
          uploadForm
            .bindFromRequest(request.body.dataParts)
            .fold(
              hasErrors = formWithErrors => Fox.successful(JsonBadRequest(formWithErrors.errors.head.message)),
              success = {
                case (name, organization, chunkNumber, chunkSize, totalChunkCount, totalFileCount, uploadId) =>
                  val id = DataSourceId(name, organization)
                  val resumableUploadInformation = ResumableUploadInformation(chunkSize, totalChunkCount)
                  for {
                    _ <- if (!uploadService.isKnownUpload(uploadId))
                      remoteWebKnossosClient.validateDataSourceUpload(id) ?~> "dataSet.upload.validation.failed"
                    else Fox.successful(())
                    chunkFile <- request.body.file("file") ?~> "zip.file.notFound"
                    _ <- uploadService.handleUploadChunk(uploadId,
                                                         id,
                                                         resumableUploadInformation,
                                                         chunkNumber,
                                                         totalFileCount,
                                                         new File(chunkFile.ref.path.toString))
                  } yield {
                    Ok
                  }
              }
            )
        }
      }
    }

  @ApiOperation(
    value =
      """Finish dataset upload, call after all chunks have been uploaded via uploadChunk
Expects:
 - As JSON object body with keys:
  - uploadId (string): upload id that was also used in chunk upload (this time without file paths)
  - organization (string): owning organization name
  - name (string): dataset name
  - initialTeams (list of string): names of the webknossos teams dataset should be accessible for
  - needsConversion (boolean): mark as true for non-wkw datasets. They are stored differently and a conversion job can later be run.
 - As GET parameter:
  - token (string): datastore token identifying the uploading user
""",
    nickname = "datasetFinishUpload"
  )
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "Empty body, chunk was saved on the server"),
      new ApiResponse(code = 400, message = "Operation could not be performed. See JSON body for more information.")
    ))
  def finishUpload(token: String): Action[UploadInformation] = Action.async(validateJson[UploadInformation]) {
    implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources, Some(token)) {
        AllowRemoteOrigin {
          for {
            (dataSourceId, initialTeams, dataSetSizeBytes) <- uploadService.finishUpload(request.body)
            _ <- remoteWebKnossosClient
              .reportUpload(dataSourceId, initialTeams, dataSetSizeBytes, token) ?~> "setInitialTeams.failed"
          } yield Ok
        }
      }

  }

  @ApiOperation(hidden = true, value = "")
  def fetchSampleDataSource(token: Option[String], organizationName: String, dataSetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources, token) {
        AllowRemoteOrigin {
          for {
            _ <- sampleDatasetService.initDownload(organizationName, dataSetName)
          } yield JsonOk(Json.obj("messages" -> "downloadInitiated"))
        }
      }
    }

  @ApiOperation(hidden = true, value = "")
  def listSampleDataSources(token: Option[String], organizationName: String): Action[AnyContent] = Action.async {
    implicit request =>
      AllowRemoteOrigin {
        accessTokenService.validateAccessForSyncBlock(UserAccessRequest.administrateDataSources, token) {
          Ok(Json.toJson(sampleDatasetService.listWithStatus(organizationName)))
        }
      }
  }

  @ApiOperation(hidden = true, value = "")
  def explore(token: Option[String], organizationName: String, dataSetName: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService.validateAccessForSyncBlock(
        UserAccessRequest.writeDataSource(DataSourceId(dataSetName, organizationName)),
        token) {
        AllowRemoteOrigin {
          for {
            previousDataSource <- dataSourceRepository.find(DataSourceId(dataSetName, organizationName)) ?~ Messages(
              "dataSource.notFound") ~> 404
            (dataSource, messages) <- dataSourceService.exploreDataSource(previousDataSource.id,
                                                                          previousDataSource.toUsable)
            previousDataSourceJson = previousDataSource match {
              case usableDataSource: DataSource => Json.toJson(usableDataSource)
              case unusableDataSource: UnusableInboxDataSource =>
                unusableDataSource.existingDataSourceProperties match {
                  case Some(existingConfig) => existingConfig
                  case None                 => Json.toJson(unusableDataSource)
                }
            }
          } yield {
            Ok(
              Json.obj(
                "dataSource" -> dataSource,
                "previousDataSource" -> previousDataSourceJson,
                "messages" -> messages.map(m => Json.obj(m._1 -> m._2))
              ))
          }
        }
      }
  }

  @ApiOperation(hidden = true, value = "")
  def listMappings(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(
      UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
      token) {
      AllowRemoteOrigin {
        Ok(Json.toJson(dataSourceService.exploreMappings(organizationName, dataSetName, dataLayerName)))
      }
    }
  }

  @ApiOperation(hidden = true, value = "")
  def listAgglomerates(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(
      UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
      token) {
      AllowRemoteOrigin {
        Ok(
          Json.toJson(binaryDataServiceHolder.binaryDataService.agglomerateService
            .exploreAgglomerates(organizationName, dataSetName, dataLayerName)))
      }
    }
  }

  @ApiOperation(hidden = true, value = "")
  def generateAgglomerateSkeleton(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      token) {
      AllowRemoteOrigin {
        for {
          skeleton <- binaryDataServiceHolder.binaryDataService.agglomerateService.generateSkeleton(
            organizationName,
            dataSetName,
            dataLayerName,
            mappingName,
            agglomerateId) ?~> "agglomerateSkeleton.failed"
        } yield Ok(skeleton.toByteArray).as("application/x-protobuf")
      }
    }
  }

  @ApiOperation(hidden = true, value = "")
  def listMeshFiles(token: Option[String],
                    organizationName: String,
                    dataSetName: String,
                    dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessForSyncBlock(
        UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
        token) {
        AllowRemoteOrigin {
          Ok(Json.toJson(meshFileService.exploreMeshFiles(organizationName, dataSetName, dataLayerName)))
        }
      }
    }

  @ApiOperation(hidden = true, value = "")
  def listMeshChunksForSegment(token: Option[String],
                               organizationName: String,
                               dataSetName: String,
                               dataLayerName: String): Action[ListMeshChunksRequest] =
    Action.async(validateJson[ListMeshChunksRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        token) {
        AllowRemoteOrigin {
          for {
            positions <- meshFileService.listMeshChunksForSegment(
              organizationName,
              dataSetName,
              dataLayerName,
              request.body) ?~> Messages("mesh.file.listChunks.failed",
                                         request.body.segmentId.toString,
                                         request.body.meshFile) ?~> Messages(
              "mesh.file.load.failed",
              request.body.segmentId.toString) ~> BAD_REQUEST
          } yield Ok(Json.toJson(positions))
        }
      }
    }

  @ApiOperation(hidden = true, value = "")
  def readMeshChunk(token: Option[String],
                    organizationName: String,
                    dataSetName: String,
                    dataLayerName: String): Action[MeshChunkDataRequest] =
    Action.async(validateJson[MeshChunkDataRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        token) {
        AllowRemoteOrigin {
          for {
            (data, encoding) <- meshFileService.readMeshChunk(organizationName,
                                                              dataSetName,
                                                              dataLayerName,
                                                              request.body) ?~> "mesh.file.loadChunk.failed"
          } yield {
            if (encoding.contains("gzip")) {
              Ok(data).withHeaders("Content-Encoding" -> "gzip")
            } else {
              Ok(data)
            }
          }
        }
      }
    }

  @ApiOperation(hidden = true, value = "")
  def update(token: Option[String], organizationName: String, dataSetName: String): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.writeDataSource(DataSourceId(dataSetName, organizationName)),
                                        token) {
        AllowRemoteOrigin {
          for {
            _ <- Fox.successful(())
            dataSource <- dataSourceRepository.find(DataSourceId(dataSetName, organizationName)).toFox ?~> Messages(
              "dataSource.notFound") ~> 404
            _ <- dataSourceService.updateDataSource(request.body.copy(id = dataSource.id))
          } yield {
            Ok
          }
        }
      }
    }

  @ApiOperation(hidden = true, value = "")
  def createOrganizationDirectory(token: Option[String], organizationName: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService.validateAccessForSyncBlock(UserAccessRequest.administrateDataSources, token) {
        AllowRemoteOrigin {
          val newOrganizationFolder = new File(dataSourceService.dataBaseDir + "/" + organizationName)
          newOrganizationFolder.mkdirs()
          if (newOrganizationFolder.isDirectory)
            Ok
          else
            BadRequest
        }
      }
  }

  @ApiOperation(hidden = true, value = "")
  def reload(token: Option[String],
             organizationName: String,
             dataSetName: String,
             layerName: Option[String] = None): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources, token) {
        AllowRemoteOrigin {
          val count = binaryDataServiceHolder.binaryDataService.clearCache(organizationName, dataSetName, layerName)
          logger.info(
            s"Reloading ${layerName.map(l => s"layer '$l' of ").getOrElse("")}datasource $organizationName / $dataSetName: closed $count open file handles.")
          val reloadedDataSource = dataSourceService.dataSourceFromFolder(
            dataSourceService.dataBaseDir.resolve(organizationName).resolve(dataSetName),
            organizationName)
          for {
            _ <- dataSourceRepository.updateDataSource(reloadedDataSource)
          } yield Ok(Json.toJson(reloadedDataSource))
        }
      }
    }

  @ApiOperation(hidden = true, value = "")
  def deleteOnDisk(token: Option[String], organizationName: String, dataSetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.deleteDataSource(DataSourceId(dataSetName, organizationName)),
                                        token) {
        AllowRemoteOrigin {
          for {
            _ <- binaryDataServiceHolder.binaryDataService.deleteOnDisk(organizationName,
                                                                        dataSetName,
                                                                        reason =
                                                                          Some("the user wants to delete the dataset"))
          } yield Ok
        }
      }
    }

}
