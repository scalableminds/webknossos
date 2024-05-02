package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.ListOfLong.ListOfLong
import com.scalableminds.webknossos.datastore.helpers.{
  GetMultipleSegmentIndexParameters,
  GetSegmentIndexParameters,
  SegmentIndexData,
  SegmentStatisticsParameters
}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{
  InboxDataSource,
  InboxDataSourceLike,
  UnusableInboxDataSource
}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.services.uploading.{
  CancelUploadInformation,
  ComposeRequest,
  ComposeService,
  ReserveUploadInformation,
  UploadInformation,
  UploadService
}
import play.api.data.Form
import play.api.data.Forms.{longNumber, nonEmptyText, number, tuple}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}

import java.io.File
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey
import net.liftweb.common.Full
import play.api.libs.Files

import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._

class DataSourceController @Inject()(
    dataSourceRepository: DataSourceRepository,
    dataSourceService: DataSourceService,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    accessTokenService: DataStoreAccessTokenService,
    val binaryDataServiceHolder: BinaryDataServiceHolder,
    connectomeFileService: ConnectomeFileService,
    segmentIndexFileService: SegmentIndexFileService,
    storageUsageService: DSUsedStorageService,
    datasetErrorLoggingService: DatasetErrorLoggingService,
    uploadService: UploadService,
    composeService: ComposeService,
    val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
    val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller
    with MeshMappingHelper
    with FoxImplicits {

  override def allowRemoteOrigin: Boolean = true

  def read(token: Option[String],
           organizationName: String,
           datasetName: String,
           returnFormatLike: Boolean): Action[AnyContent] =
    Action.async { implicit request =>
      {
        accessTokenService.validateAccessForSyncBlock(
          UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
          urlOrHeaderToken(token, request)) {
          val dsOption: Option[InboxDataSource] =
            dataSourceRepository.find(DataSourceId(datasetName, organizationName))
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

  def triggerInboxCheckBlocking(token: Option[String]): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.administrateDataSources, urlOrHeaderToken(token, request)) {
      for {
        _ <- dataSourceService.checkInbox(verbose = true)
      } yield Ok
    }
  }

  def reserveUpload(token: Option[String]): Action[ReserveUploadInformation] =
    Action.async(validateJson[ReserveUploadInformation]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources(request.body.organization),
                                        urlOrHeaderToken(token, request)) {
        for {
          isKnownUpload <- uploadService.isKnownUpload(request.body.uploadId)
          _ <- if (!isKnownUpload) {
            (remoteWebknossosClient.reserveDataSourceUpload(request.body, urlOrHeaderToken(token, request)) ?~> "dataset.upload.validation.failed")
              .flatMap(_ => uploadService.reserveUpload(request.body))
          } else Fox.successful(())
        } yield Ok
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
                  uploadService.extractDatasetUploadId(uploadFileId)) ?~> "dataset.upload.validation.failed"
                result <- accessTokenService.validateAccess(UserAccessRequest.writeDataSource(dataSourceId),
                                                            urlOrHeaderToken(token, request)) {
                  for {
                    isKnownUpload <- uploadService.isKnownUploadByFileId(uploadFileId)
                    _ <- bool2Fox(isKnownUpload) ?~> "dataset.upload.validation.failed"
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

  def finishUpload(token: Option[String]): Action[UploadInformation] = Action.async(validateJson[UploadInformation]) {
    implicit request =>
      log() {
        for {
          dataSourceId <- uploadService
            .getDataSourceIdByUploadId(request.body.uploadId) ?~> "dataset.upload.validation.failed"
          result <- accessTokenService.validateAccess(UserAccessRequest.writeDataSource(dataSourceId),
                                                      urlOrHeaderToken(token, request)) {
            for {
              (dataSourceId, datasetSizeBytes) <- uploadService.finishUpload(request.body)
              _ <- remoteWebknossosClient.reportUpload(
                dataSourceId,
                datasetSizeBytes,
                request.body.needsConversion.getOrElse(false),
                viaAddRoute = false,
                userToken = urlOrHeaderToken(token, request)) ?~> "reportUpload.failed"
            } yield Ok
          }
        } yield result
      }
  }

  def cancelUpload(token: Option[String]): Action[CancelUploadInformation] =
    Action.async(validateJson[CancelUploadInformation]) { implicit request =>
      val dataSourceIdFox = uploadService.isKnownUpload(request.body.uploadId).flatMap {
        case false => Fox.failure("dataset.upload.validation.failed")
        case true  => uploadService.getDataSourceIdByUploadId(request.body.uploadId)
      }
      dataSourceIdFox.flatMap { dataSourceId =>
        accessTokenService.validateAccess(UserAccessRequest.deleteDataSource(dataSourceId),
                                          urlOrHeaderToken(token, request)) {
          for {
            _ <- remoteWebknossosClient.deleteDataSource(dataSourceId) ?~> "dataset.delete.webknossos.failed"
            _ <- uploadService.cancelUpload(request.body) ?~> "Could not cancel the upload."
          } yield Ok
        }
      }
    }

  def suggestDatasourceJson(token: Option[String], organizationName: String, datasetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessForSyncBlock(
        UserAccessRequest.writeDataSource(DataSourceId(datasetName, organizationName)),
        urlOrHeaderToken(token, request)) {
        for {
          previousDataSource <- dataSourceRepository.find(DataSourceId(datasetName, organizationName)) ?~ Messages(
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

  def listMappings(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(
      UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
      urlOrHeaderToken(token, request)) {
      addNoCacheHeaderFallback(
        Ok(Json.toJson(dataSourceService.exploreMappings(organizationName, datasetName, dataLayerName))))
    }
  }

  def listAgglomerates(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        agglomerateList = agglomerateService.exploreAgglomerates(organizationName, datasetName, dataLayerName)
      } yield Ok(Json.toJson(agglomerateList))
    }
  }

  def generateAgglomerateSkeleton(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        skeleton <- agglomerateService.generateSkeleton(organizationName,
                                                        datasetName,
                                                        dataLayerName,
                                                        mappingName,
                                                        agglomerateId) ?~> "agglomerateSkeleton.failed"
      } yield Ok(skeleton.toByteArray).as(protobufMimeType)
    }
  }

  def agglomerateGraph(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        agglomerateGraph <- agglomerateService.generateAgglomerateGraph(
          AgglomerateFileKey(organizationName, datasetName, dataLayerName, mappingName),
          agglomerateId) ?~> "agglomerateGraph.failed"
      } yield Ok(agglomerateGraph.toByteArray).as(protobufMimeType)
    }
  }

  def largestAgglomerateId(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        largestAgglomerateId: Long <- agglomerateService
          .largestAgglomerateId(
            AgglomerateFileKey(
              organizationName,
              datasetName,
              dataLayerName,
              mappingName
            )
          )
          .toFox
      } yield Ok(Json.toJson(largestAgglomerateId))
    }
  }

  def agglomerateIdsForSegmentIds(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[ListOfLong] = Action.async(validateProto[ListOfLong]) { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        agglomerateIds: Seq[Long] <- agglomerateService
          .agglomerateIdsForSegmentIds(
            AgglomerateFileKey(
              organizationName,
              datasetName,
              dataLayerName,
              mappingName
            ),
            request.body.items
          )
          .toFox
      } yield Ok(ListOfLong(agglomerateIds).toByteArray)
    }
  }

  def agglomerateIdsForAllSegmentIds(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[ListOfLong] = Action.async(validateProto[ListOfLong]) { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        agglomerateIds: Array[Long] <- agglomerateService
          .agglomerateIdsForAllSegmentIds(
            AgglomerateFileKey(
              organizationName,
              datasetName,
              dataLayerName,
              mappingName
            )
          )
          .toFox
      } yield Ok(Json.toJson(agglomerateIds))
    }
  }

  def update(token: Option[String], organizationName: String, datasetName: String): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.writeDataSource(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          _ <- Fox.successful(())
          dataSource <- dataSourceRepository.find(DataSourceId(datasetName, organizationName)).toFox ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND
          _ <- dataSourceService.updateDataSource(request.body.copy(id = dataSource.id), expectExisting = true)
        } yield Ok
      }
    }

  def add(token: Option[String],
          organizationName: String,
          datasetName: String,
          folderId: Option[String]): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources, urlOrHeaderToken(token, request)) {
        for {
          _ <- bool2Fox(dataSourceRepository.find(DataSourceId(datasetName, organizationName)).isEmpty) ?~> Messages(
            "dataSource.alreadyPresent")
          _ <- remoteWebknossosClient.reserveDataSourceUpload(
            ReserveUploadInformation(
              uploadId = "",
              name = datasetName,
              organization = organizationName,
              totalFileCount = 1,
              layersToLink = None,
              initialTeams = List.empty,
              folderId = folderId,
            ),
            urlOrHeaderToken(token, request)
          ) ?~> "dataset.upload.validation.failed"
          _ <- dataSourceService.updateDataSource(request.body.copy(id = DataSourceId(datasetName, organizationName)),
                                                  expectExisting = false)
          _ <- remoteWebknossosClient.reportUpload(
            DataSourceId(datasetName, organizationName),
            0L,
            needsConversion = false,
            viaAddRoute = true,
            userToken = urlOrHeaderToken(token, request)) ?~> "reportUpload.failed"
        } yield Ok
      }
    }

  def createOrganizationDirectory(token: Option[String], organizationName: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService
        .validateAccessForSyncBlock(UserAccessRequest.administrateDataSources(organizationName), token) {
          val newOrganizationDirectory = new File(f"${dataSourceService.dataBaseDir}/$organizationName")
          newOrganizationDirectory.mkdirs()
          if (newOrganizationDirectory.isDirectory) {
            logger.info(s"Created organization directory at $newOrganizationDirectory")
            Ok
          } else
            BadRequest
        }
  }

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

  def reload(token: Option[String],
             organizationName: String,
             datasetName: String,
             layerName: Option[String] = None): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources(organizationName),
                                        urlOrHeaderToken(token, request)) {
        val (closedAgglomerateFileHandleCount, closedDataCubeHandleCount, removedChunksCount) =
          binaryDataServiceHolder.binaryDataService.clearCache(organizationName, datasetName, layerName)
        val reloadedDataSource = dataSourceService.dataSourceFromFolder(
          dataSourceService.dataBaseDir.resolve(organizationName).resolve(datasetName),
          organizationName)
        datasetErrorLoggingService.clearForDataset(organizationName, datasetName)
        for {
          clearedVaultCacheEntriesBox <- dataSourceService.invalidateVaultCache(reloadedDataSource, layerName).futureBox
          _ = clearedVaultCacheEntriesBox match {
            case Full(clearedVaultCacheEntries) =>
              logger.info(
                s"Reloading ${layerName.map(l => s"layer '$l' of ").getOrElse("")}dataset $organizationName/$datasetName: closed $closedDataCubeHandleCount data shard / array handles, $closedAgglomerateFileHandleCount agglomerate file handles, removed $clearedVaultCacheEntries vault cache entries and $removedChunksCount image chunk cache entries.")
            case _ => ()
          }
          _ <- dataSourceRepository.updateDataSource(reloadedDataSource)
        } yield Ok(Json.toJson(reloadedDataSource))
      }
    }

  def deleteOnDisk(token: Option[String], organizationName: String, datasetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      val dataSourceId = DataSourceId(datasetName, organizationName)
      accessTokenService.validateAccess(UserAccessRequest.deleteDataSource(dataSourceId),
                                        urlOrHeaderToken(token, request)) {
        for {
          _ <- binaryDataServiceHolder.binaryDataService.deleteOnDisk(
            organizationName,
            datasetName,
            reason = Some("the user wants to delete the dataset")) ?~> "dataset.delete.failed"
          _ <- dataSourceRepository.cleanUpDataSource(dataSourceId) // also frees the name in the wk-side database
        } yield Ok
      }
    }

  def compose(token: Option[String]): Action[ComposeRequest] =
    Action.async(validateJson[ComposeRequest]) { implicit request =>
      val userToken = urlOrHeaderToken(token, request)
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources(request.body.organizationName), token) {
        for {
          _ <- Fox.serialCombined(request.body.layers.map(_.datasetId).toList)(
            id =>
              accessTokenService.assertUserAccess(
                UserAccessRequest.readDataSources(DataSourceId(id.name, id.owningOrganization)),
                userToken))
          dataSource <- composeService.composeDataset(request.body, userToken)
          _ <- dataSourceRepository.updateDataSource(dataSource)
        } yield Ok
      }
    }

  def listConnectomeFiles(token: Option[String],
                          organizationName: String,
                          datasetName: String,
                          dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        val connectomeFileNames =
          connectomeFileService.exploreConnectomeFiles(organizationName, datasetName, dataLayerName)
        for {
          mappingNames <- Fox.serialCombined(connectomeFileNames.toList) { connectomeFileName =>
            val path =
              connectomeFileService.connectomeFilePath(organizationName, datasetName, dataLayerName, connectomeFileName)
            connectomeFileService.mappingNameForConnectomeFile(path)
          }
          connectomesWithMappings = connectomeFileNames
            .zip(mappingNames)
            .map(tuple => ConnectomeFileNameWithMappingName(tuple._1, tuple._2))
        } yield Ok(Json.toJson(connectomesWithMappings))
      }
    }

  def getSynapsesForAgglomerates(token: Option[String],
                                 organizationName: String,
                                 datasetName: String,
                                 dataLayerName: String): Action[ByAgglomerateIdsRequest] =
    Action.async(validateJson[ByAgglomerateIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, datasetName, dataLayerName, request.body.connectomeFile))
          synapses <- connectomeFileService.synapsesForAgglomerates(meshFilePath, request.body.agglomerateIds)
        } yield Ok(Json.toJson(synapses))
      }
    }

  def getSynapticPartnerForSynapses(token: Option[String],
                                    organizationName: String,
                                    datasetName: String,
                                    dataLayerName: String,
                                    direction: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, datasetName, dataLayerName, request.body.connectomeFile))
          agglomerateIds <- connectomeFileService.synapticPartnerForSynapses(meshFilePath,
                                                                             request.body.synapseIds,
                                                                             direction)
        } yield Ok(Json.toJson(agglomerateIds))
      }
    }

  def getSynapsePositions(token: Option[String],
                          organizationName: String,
                          datasetName: String,
                          dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, datasetName, dataLayerName, request.body.connectomeFile))
          synapsePositions <- connectomeFileService.positionsForSynapses(meshFilePath, request.body.synapseIds)
        } yield Ok(Json.toJson(synapsePositions))
      }
    }

  def getSynapseTypes(token: Option[String],
                      organizationName: String,
                      datasetName: String,
                      dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, datasetName, dataLayerName, request.body.connectomeFile))
          synapseTypes <- connectomeFileService.typesForSynapses(meshFilePath, request.body.synapseIds)
        } yield Ok(Json.toJson(synapseTypes))
      }
    }

  def checkSegmentIndexFile(token: Option[String],
                            organizationName: String,
                            dataSetName: String,
                            dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        val segmentIndexFileOpt =
          segmentIndexFileService.getSegmentIndexFile(organizationName, dataSetName, dataLayerName).toOption
        Future.successful(Ok(Json.toJson(segmentIndexFileOpt.isDefined)))
      }
    }

  /**
    * Query the segment index file for a single segment
    * @return List of bucketPositions as positions (not indices) of 32³ buckets in mag
    */
  def getSegmentIndex(token: Option[String],
                      organizationName: String,
                      datasetName: String,
                      dataLayerName: String,
                      segmentId: String): Action[GetSegmentIndexParameters] =
    Action.async(validateJson[GetSegmentIndexParameters]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
            organizationName,
            datasetName,
            dataLayerName,
            request.body.mappingName,
            request.body.editableMappingTracingId,
            segmentId.toLong,
            mappingNameForMeshFile = None,
            urlOrHeaderToken(token, request)
          )
          fileMag <- segmentIndexFileService.readFileMag(organizationName, datasetName, dataLayerName)
          topLeftsNested: Seq[Array[Vec3Int]] <- Fox.serialCombined(segmentIds)(sId =>
            segmentIndexFileService.readSegmentIndex(organizationName, datasetName, dataLayerName, sId))
          topLefts: Array[Vec3Int] = topLeftsNested.toArray.flatten
          bucketPositions = segmentIndexFileService.topLeftsToDistinctBucketPositions(topLefts,
                                                                                      request.body.mag,
                                                                                      fileMag)
          bucketPositionsForCubeSize = bucketPositions
            .map(_.scale(DataLayer.bucketLength)) // bucket positions raw are indices of 32³ buckets
            .map(_ / request.body.cubeSize)
            .distinct // divide by requested cube size to map them to larger buckets, select unique
            .map(_ * request.body.cubeSize) // return positions, not indices
        } yield Ok(Json.toJson(bucketPositionsForCubeSize))
      }
    }

  /**
    * Query the segment index file for multiple segments
    * @return List of bucketPositions as indices of 32³ buckets
    */
  def querySegmentIndex(token: Option[String],
                        organizationName: String,
                        datasetName: String,
                        dataLayerName: String): Action[GetMultipleSegmentIndexParameters] =
    Action.async(validateJson[GetMultipleSegmentIndexParameters]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          segmentIdsAndBucketPositions <- Fox.serialCombined(request.body.segmentIds) { segmentOrAgglomerateId =>
            for {
              segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
                organizationName,
                datasetName,
                dataLayerName,
                request.body.mappingName,
                request.body.editableMappingTracingId,
                segmentOrAgglomerateId,
                mappingNameForMeshFile = None,
                urlOrHeaderToken(token, request)
              )
              fileMag <- segmentIndexFileService.readFileMag(organizationName, datasetName, dataLayerName)
              topLeftsNested: Seq[Array[Vec3Int]] <- Fox.serialCombined(segmentIds)(sId =>
                segmentIndexFileService.readSegmentIndex(organizationName, datasetName, dataLayerName, sId))
              topLefts: Array[Vec3Int] = topLeftsNested.toArray.flatten
              bucketPositions = segmentIndexFileService.topLeftsToDistinctBucketPositions(topLefts,
                                                                                          request.body.mag,
                                                                                          fileMag)
            } yield SegmentIndexData(segmentOrAgglomerateId, bucketPositions.toSeq)
          }
        } yield Ok(Json.toJson(segmentIdsAndBucketPositions))
      }
    }

  def getSegmentVolume(token: Option[String],
                       organizationName: String,
                       datasetName: String,
                       dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          _ <- segmentIndexFileService.assertSegmentIndexFileExists(organizationName, datasetName, dataLayerName)
          volumes <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            segmentIndexFileService.getSegmentVolume(
              organizationName,
              datasetName,
              dataLayerName,
              segmentId,
              request.body.mag,
              request.body.mappingName
            )
          }
        } yield Ok(Json.toJson(volumes))
      }
    }

  def getSegmentBoundingBox(token: Option[String],
                            organizationName: String,
                            datasetName: String,
                            dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          _ <- segmentIndexFileService.assertSegmentIndexFileExists(organizationName, datasetName, dataLayerName)
          boxes <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            segmentIndexFileService.getSegmentBoundingBox(organizationName,
                                                          datasetName,
                                                          dataLayerName,
                                                          segmentId,
                                                          request.body.mag,
                                                          request.body.mappingName)
          }
        } yield Ok(Json.toJson(boxes))
      }
    }

}
