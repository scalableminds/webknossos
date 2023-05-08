package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.ListOfLong.ListOfLong
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
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey
import io.swagger.annotations.{Api, ApiImplicitParam, ApiImplicitParams, ApiOperation, ApiResponse, ApiResponses}
import play.api.libs.Files

import scala.concurrent.duration._
import scala.concurrent.ExecutionContext.Implicits.global

@Api(tags = Array("datastore"))
class DataSourceController @Inject()(
    dataSourceRepository: DataSourceRepository,
    dataSourceService: DataSourceService,
    remoteWebKnossosClient: DSRemoteWebKnossosClient,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    connectomeFileService: ConnectomeFileService,
    storageUsageService: DSUsedStorageService,
    datasetErrorLoggingService: DatasetErrorLoggingService,
    uploadService: UploadService
)(implicit bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  override def allowRemoteOrigin: Boolean = true

  @ApiOperation(hidden = true, value = "")
  def read(token: Option[String],
           organizationName: String,
           dataSetName: String,
           returnFormatLike: Boolean): Action[AnyContent] =
    Action.async { implicit request =>
      {
        accessTokenService.validateAccessForSyncBlock(
          UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
          urlOrHeaderToken(token, request)) {
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

  @ApiOperation(hidden = true, value = "")
  def triggerInboxCheckBlocking(token: Option[String]): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.administrateDataSources, urlOrHeaderToken(token, request)) {
      for {
        _ <- dataSourceService.checkInbox(verbose = true)
      } yield Ok
    }
  }

  @ApiOperation(
    value =
      """Reserve an upload for a new dataset
Expects:
 - As JSON object body with keys:
  - uploadId (string): upload id that was also used in chunk upload (this time without file paths)
  - organization (string): owning organization name
  - name (string): dataset name
  - needsConversion (boolean): mark as true for non-wkw datasets. They are stored differently and a conversion job can later be run.
  - initialTeams (list of string): names of the webknossos teams dataset should be accessible for
 - As GET parameter:
  - token (string): datastore token identifying the uploading user
""",
    nickname = "datasetReserveUpload"
  )
  @ApiImplicitParams(
    Array(
      new ApiImplicitParam(name = "reserveUploadInformation",
                           required = true,
                           dataTypeClass = classOf[ReserveUploadInformation],
                           paramType = "body")))
  def reserveUpload(token: Option[String]): Action[ReserveUploadInformation] =
    Action.async(validateJson[ReserveUploadInformation]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources(request.body.organization),
                                        urlOrHeaderToken(token, request)) {
        for {
          isKnownUpload <- uploadService.isKnownUpload(request.body.uploadId)
          _ <- if (!isKnownUpload) {
            (remoteWebKnossosClient.reserveDataSourceUpload(request.body, urlOrHeaderToken(token, request)) ?~> "dataSet.upload.validation.failed")
              .flatMap(_ => uploadService.reserveUpload(request.body))
          } else Fox.successful(())
        } yield Ok
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
  def uploadChunk(token: Option[String]): Action[MultipartFormData[Files.TemporaryFile]] =
    Action.async(parse.multipartFormData) { implicit request =>
      val uploadForm = Form(
        tuple(
          "resumableChunkNumber" -> number,
          "resumableChunkSize" -> number,
          "resumableTotalChunks" -> longNumber,
          "resumableIdentifier" -> nonEmptyText
        )).fill((-1, -1, -1, ""))

      uploadForm
        .bindFromRequest(request.body.dataParts)
        .fold(
          hasErrors = formWithErrors => Fox.successful(JsonBadRequest(formWithErrors.errors.head.message)),
          success = {
            case (chunkNumber, chunkSize, totalChunkCount, uploadFileId) =>
              for {
                dataSourceId <- uploadService.getDataSourceIdByUploadId(
                  uploadService.extractDatasetUploadId(uploadFileId)) ?~> "dataSet.upload.validation.failed"
                result <- accessTokenService.validateAccess(UserAccessRequest.writeDataSource(dataSourceId),
                                                            urlOrHeaderToken(token, request)) {
                  for {
                    isKnownUpload <- uploadService.isKnownUploadByFileId(uploadFileId)
                    _ <- bool2Fox(isKnownUpload) ?~> "dataSet.upload.validation.failed"
                    chunkFile <- request.body.file("file") ?~> "zip.file.notFound"
                    _ <- uploadService.handleUploadChunk(uploadFileId,
                                                         chunkSize,
                                                         totalChunkCount,
                                                         chunkNumber,
                                                         new File(chunkFile.ref.path.toString))
                  } yield Ok
                }
              } yield result
          }
        )
    }

  @ApiOperation(
    value =
      """Finish dataset upload, call after all chunks have been uploaded via uploadChunk
Expects:
 - As JSON object body with keys:
  - uploadId (string): upload id that was also used in chunk upload (this time without file paths)
  - organization (string): owning organization name
  - name (string): dataset name
  - needsConversion (boolean): mark as true for non-wkw datasets. They are stored differently and a conversion job can later be run.
 - As GET parameter:
  - token (string): datastore token identifying the uploading user
""",
    nickname = "datasetFinishUpload"
  )
  @ApiImplicitParams(
    Array(
      new ApiImplicitParam(name = "uploadInformation",
                           required = true,
                           dataTypeClass = classOf[UploadInformation],
                           paramType = "body")))
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "Empty body, upload was successfully finished"),
      new ApiResponse(code = 400, message = "Operation could not be performed. See JSON body for more information.")
    ))
  def finishUpload(token: Option[String]): Action[UploadInformation] = Action.async(validateJson[UploadInformation]) {
    implicit request =>
      log() {
        for {
          dataSourceId <- uploadService
            .getDataSourceIdByUploadId(request.body.uploadId) ?~> "dataSet.upload.validation.failed"
          result <- accessTokenService.validateAccess(UserAccessRequest.writeDataSource(dataSourceId),
                                                      urlOrHeaderToken(token, request)) {
            for {
              (dataSourceId, dataSetSizeBytes) <- uploadService.finishUpload(request.body)
              _ <- remoteWebKnossosClient.reportUpload(dataSourceId,
                                                       dataSetSizeBytes,
                                                       request.body.needsConversion.getOrElse(false),
                                                       urlOrHeaderToken(token, request)) ?~> "reportUpload.failed"
            } yield Ok
          }
        } yield result
      }
  }

  @ApiOperation(
    value = """Cancel a running dataset upload
Expects:
 - As JSON object body with keys:
  - uploadId (string): upload id that was also used in chunk upload (this time without file paths)
 - As GET parameter:
  - token (string): datastore token identifying the uploading user
""",
    nickname = "datasetCancelUpload"
  )
  @ApiImplicitParams(
    Array(
      new ApiImplicitParam(name = "cancelUploadInformation",
                           required = true,
                           dataTypeClass = classOf[CancelUploadInformation],
                           paramType = "body")))
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "Empty body, upload was cancelled"),
      new ApiResponse(code = 400, message = "Operation could not be performed. See JSON body for more information.")
    ))
  def cancelUpload(token: Option[String]): Action[CancelUploadInformation] =
    Action.async(validateJson[CancelUploadInformation]) { implicit request =>
      val dataSourceIdFox = uploadService.isKnownUpload(request.body.uploadId).flatMap {
        case false => Fox.failure("dataSet.upload.validation.failed")
        case true  => uploadService.getDataSourceIdByUploadId(request.body.uploadId)
      }
      dataSourceIdFox.flatMap { dataSourceId =>
        accessTokenService.validateAccess(UserAccessRequest.deleteDataSource(dataSourceId),
                                          urlOrHeaderToken(token, request)) {
          for {
            _ <- remoteWebKnossosClient.deleteDataSource(dataSourceId) ?~> "dataSet.delete.webknossos.failed"
            _ <- uploadService.cancelUpload(request.body) ?~> "Could not cancel the upload."
          } yield Ok
        }
      }
    }

  @ApiOperation(hidden = true, value = "")
  def explore(token: Option[String], organizationName: String, dataSetName: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService.validateAccessForSyncBlock(
        UserAccessRequest.writeDataSource(DataSourceId(dataSetName, organizationName)),
        urlOrHeaderToken(token, request)) {
        for {
          previousDataSource <- dataSourceRepository.find(DataSourceId(dataSetName, organizationName)) ?~ Messages(
            "dataSource.notFound") ~> NOT_FOUND
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

  @ApiOperation(hidden = true, value = "")
  def listMappings(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(
      UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
      urlOrHeaderToken(token, request)) {
      addNoCacheHeaderFallback(
        Ok(Json.toJson(dataSourceService.exploreMappings(organizationName, dataSetName, dataLayerName))))
    }
  }

  @ApiOperation(hidden = true, value = "")
  def listAgglomerates(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        agglomerateList = agglomerateService.exploreAgglomerates(organizationName, dataSetName, dataLayerName)
      } yield Ok(Json.toJson(agglomerateList))
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
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        skeleton <- agglomerateService.generateSkeleton(organizationName,
                                                        dataSetName,
                                                        dataLayerName,
                                                        mappingName,
                                                        agglomerateId) ?~> "agglomerateSkeleton.failed"
      } yield Ok(skeleton.toByteArray).as(protobufMimeType)
    }
  }

  @ApiOperation(hidden = true, value = "")
  def agglomerateGraph(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        agglomerateGraph <- agglomerateService.generateAgglomerateGraph(
          AgglomerateFileKey(organizationName, dataSetName, dataLayerName, mappingName),
          agglomerateId) ?~> "agglomerateGraph.failed"
      } yield Ok(agglomerateGraph.toByteArray).as(protobufMimeType)
    }
  }

  @ApiOperation(hidden = true, value = "")
  def largestAgglomerateId(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        largestAgglomerateId: Long <- agglomerateService
          .largestAgglomerateId(
            AgglomerateFileKey(
              organizationName,
              dataSetName,
              dataLayerName,
              mappingName
            )
          )
          .toFox
      } yield Ok(Json.toJson(largestAgglomerateId))
    }
  }

  @ApiOperation(hidden = true, value = "")
  def agglomerateIdsForSegmentIds(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[ListOfLong] = Action.async(validateProto[ListOfLong]) { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        agglomerateIds: Seq[Long] <- agglomerateService
          .agglomerateIdsForSegmentIds(
            AgglomerateFileKey(
              organizationName,
              dataSetName,
              dataLayerName,
              mappingName
            ),
            request.body.items
          )
          .toFox
      } yield Ok(ListOfLong(agglomerateIds).toByteArray)
    }
  }

  @ApiOperation(hidden = true, value = "")
  def update(token: Option[String], organizationName: String, dataSetName: String): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.writeDataSource(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          _ <- Fox.successful(())
          dataSource <- dataSourceRepository.find(DataSourceId(dataSetName, organizationName)).toFox ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND
          _ <- dataSourceService.updateDataSource(request.body.copy(id = dataSource.id), expectExisting = true)
        } yield Ok
      }
    }

  @ApiOperation(hidden = true, value = "")
  def add(token: Option[String], organizationName: String, dataSetName: String): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources, urlOrHeaderToken(token, request)) {
        for {
          _ <- bool2Fox(dataSourceRepository.find(DataSourceId(dataSetName, organizationName)).isEmpty) ?~> Messages(
            "dataSource.alreadyPresent")
          _ <- dataSourceService.updateDataSource(request.body.copy(id = DataSourceId(dataSetName, organizationName)),
                                                  expectExisting = false)
        } yield Ok
      }
    }

  @ApiOperation(hidden = true, value = "")
  def createOrganizationDirectory(token: Option[String], organizationName: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService
        .validateAccessForSyncBlock(UserAccessRequest.administrateDataSources(organizationName), token) {
          val newOrganizationFolder = new File(dataSourceService.dataBaseDir + "/" + organizationName)
          newOrganizationFolder.mkdirs()
          if (newOrganizationFolder.isDirectory)
            Ok
          else
            BadRequest
        }
  }

  @ApiOperation(hidden = true, value = "")
  def measureUsedStorage(token: Option[String],
                         organizationName: String,
                         datasetName: Option[String] = None): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.administrateDataSources(organizationName),
                                          urlOrHeaderToken(token, request)) {
          for {
            before <- Fox.successful(System.currentTimeMillis())
            usedStorageInBytes: List[DirectoryStorageReport] <- storageUsageService.measureStorage(organizationName,
                                                                                                   datasetName)
            after = System.currentTimeMillis()
            _ = if (after - before > (10 seconds).toMillis) {
              val datasetLabel = datasetName.map(n => s" dataset $n of").getOrElse("")
              logger.info(s"Measuring storage for$datasetLabel orga $organizationName took ${after - before} ms.")
            }
          } yield Ok(Json.toJson(usedStorageInBytes))
        }
      }
    }

  @ApiOperation(hidden = true, value = "")
  def reload(token: Option[String],
             organizationName: String,
             dataSetName: String,
             layerName: Option[String] = None): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources(organizationName),
                                        urlOrHeaderToken(token, request)) {
        val (closedAgglomerateFileHandleCount, closedDataCubeHandleCount) =
          binaryDataServiceHolder.binaryDataService.clearCache(organizationName, dataSetName, layerName)
        val reloadedDataSource = dataSourceService.dataSourceFromFolder(
          dataSourceService.dataBaseDir.resolve(organizationName).resolve(dataSetName),
          organizationName)
        datasetErrorLoggingService.clearForDataset(organizationName, dataSetName)
        for {
          clearedVaultCacheEntries <- dataSourceService.invalidateVaultCache(reloadedDataSource, layerName)
          _ = logger.info(
            s"Reloading ${layerName.map(l => s"layer '$l' of ").getOrElse("")}dataset $organizationName/$dataSetName: closed $closedDataCubeHandleCount data shard handles, $closedAgglomerateFileHandleCount agglomerate file handles and removed $clearedVaultCacheEntries vault cache entries.")
          _ <- dataSourceRepository.updateDataSource(reloadedDataSource)
        } yield Ok(Json.toJson(reloadedDataSource))
      }
    }

  @ApiOperation(hidden = true, value = "")
  def deleteOnDisk(token: Option[String], organizationName: String, dataSetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      val dataSourceId = DataSourceId(dataSetName, organizationName)
      accessTokenService.validateAccess(UserAccessRequest.deleteDataSource(dataSourceId),
                                        urlOrHeaderToken(token, request)) {
        for {
          _ <- binaryDataServiceHolder.binaryDataService.deleteOnDisk(
            organizationName,
            dataSetName,
            reason = Some("the user wants to delete the dataset")) ?~> "dataSet.delete.failed"
          _ <- dataSourceRepository.cleanUpDataSource(dataSourceId) // also frees the name in the wk-side database
        } yield Ok
      }
    }

  @ApiOperation(hidden = true, value = "")
  def listConnectomeFiles(token: Option[String],
                          organizationName: String,
                          dataSetName: String,
                          dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        val connectomeFileNames =
          connectomeFileService.exploreConnectomeFiles(organizationName, dataSetName, dataLayerName)
        for {
          mappingNames <- Fox.serialCombined(connectomeFileNames.toList) { connectomeFileName =>
            val path =
              connectomeFileService.connectomeFilePath(organizationName, dataSetName, dataLayerName, connectomeFileName)
            connectomeFileService.mappingNameForConnectomeFile(path)
          }
          connectomesWithMappings = connectomeFileNames
            .zip(mappingNames)
            .map(tuple => ConnectomeFileNameWithMappingName(tuple._1, tuple._2))
        } yield Ok(Json.toJson(connectomesWithMappings))
      }
    }

  @ApiOperation(hidden = true, value = "")
  def getSynapsesForAgglomerates(token: Option[String],
                                 organizationName: String,
                                 dataSetName: String,
                                 dataLayerName: String): Action[ByAgglomerateIdsRequest] =
    Action.async(validateJson[ByAgglomerateIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, dataSetName, dataLayerName, request.body.connectomeFile))
          synapses <- connectomeFileService.synapsesForAgglomerates(meshFilePath, request.body.agglomerateIds)
        } yield Ok(Json.toJson(synapses))
      }
    }

  @ApiOperation(hidden = true, value = "")
  def getSynapticPartnerForSynapses(token: Option[String],
                                    organizationName: String,
                                    dataSetName: String,
                                    dataLayerName: String,
                                    direction: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, dataSetName, dataLayerName, request.body.connectomeFile))
          agglomerateIds <- connectomeFileService.synapticPartnerForSynapses(meshFilePath,
                                                                             request.body.synapseIds,
                                                                             direction)
        } yield Ok(Json.toJson(agglomerateIds))
      }
    }

  @ApiOperation(hidden = true, value = "")
  def getSynapsePositions(token: Option[String],
                          organizationName: String,
                          dataSetName: String,
                          dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, dataSetName, dataLayerName, request.body.connectomeFile))
          synapsePositions <- connectomeFileService.positionsForSynapses(meshFilePath, request.body.synapseIds)
        } yield Ok(Json.toJson(synapsePositions))
      }
    }

  @ApiOperation(hidden = true, value = "")
  def getSynapseTypes(token: Option[String],
                      organizationName: String,
                      dataSetName: String,
                      dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, dataSetName, dataLayerName, request.body.connectomeFile))
          synapseTypes <- connectomeFileService.typesForSynapses(meshFilePath, request.body.synapseIds)
        } yield Ok(Json.toJson(synapseTypes))
      }
    }

}
