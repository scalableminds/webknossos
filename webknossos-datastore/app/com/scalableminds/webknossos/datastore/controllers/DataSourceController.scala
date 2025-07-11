package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.ListOfLong.ListOfLong
import com.scalableminds.webknossos.datastore.explore.{
  ExploreRemoteDatasetRequest,
  ExploreRemoteDatasetResponse,
  ExploreRemoteLayerService
}
import com.scalableminds.webknossos.datastore.helpers.{
  GetMultipleSegmentIndexParameters,
  GetSegmentIndexParameters,
  SegmentIndexData,
  SegmentStatisticsParameters
}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSource
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, DataSourceId, GenericDataSource}
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.services.mesh.{MeshFileService, MeshMappingHelper}
import com.scalableminds.webknossos.datastore.services.segmentindex.SegmentIndexFileService
import com.scalableminds.webknossos.datastore.services.uploading._
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import com.scalableminds.webknossos.datastore.services.connectome.{
  ByAgglomerateIdsRequest,
  BySynapseIdsRequest,
  ConnectomeFileService,
  SynapticPartnerDirection
}
import com.scalableminds.webknossos.datastore.services.mapping.AgglomerateService
import play.api.data.Form
import play.api.data.Forms.{longNumber, nonEmptyText, number, tuple}
import play.api.i18n.Messages
import play.api.libs.Files
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}

import java.io.File
import java.net.URI
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

class DataSourceController @Inject()(
    dataSourceRepository: DataSourceRepository,
    dataSourceService: DataSourceService,
    datasetCache: DatasetCache,
    accessTokenService: DataStoreAccessTokenService,
    val binaryDataServiceHolder: BinaryDataServiceHolder,
    connectomeFileService: ConnectomeFileService,
    segmentIndexFileService: SegmentIndexFileService,
    agglomerateService: AgglomerateService,
    storageUsageService: DSUsedStorageService,
    datasetErrorLoggingService: DSDatasetErrorLoggingService,
    exploreRemoteLayerService: ExploreRemoteLayerService,
    uploadService: UploadService,
    composeService: ComposeService,
    meshFileService: MeshFileService,
    val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
    val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller
    with MeshMappingHelper {

  override def allowRemoteOrigin: Boolean = true

  def readInboxDataSource(organizationId: String, datasetDirectoryName: String): Action[AnyContent] =
    Action.async { implicit request =>
      {
        accessTokenService.validateAccessFromTokenContextForSyncBlock(
          UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
          // Read directly from file, not from repository to ensure recent changes are seen
          val dataSource: InboxDataSource =
            dataSourceService.dataSourceFromDir(
              dataSourceService.dataBaseDir.resolve(organizationId).resolve(datasetDirectoryName),
              organizationId)
          Ok(Json.toJson(dataSource))
        }
      }
    }

  def triggerInboxCheckBlocking(): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.administrateDataSources) {
      for {
        _ <- dataSourceService.checkInbox(verbose = true)
      } yield Ok
    }
  }

  def reserveUpload(): Action[ReserveUploadInformation] =
    Action.async(validateJson[ReserveUploadInformation]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDataSources(request.body.organization)) {
        for {
          isKnownUpload <- uploadService.isKnownUpload(request.body.uploadId)
          _ <- if (!isKnownUpload) {
            (dsRemoteWebknossosClient.reserveDataSourceUpload(request.body) ?~> "dataset.upload.validation.failed")
              .flatMap(reserveUploadAdditionalInfo =>
                uploadService.reserveUpload(request.body, reserveUploadAdditionalInfo))
          } else Fox.successful(())
        } yield Ok
      }
    }

  def getUnfinishedUploads(organizationName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.administrateDataSources(organizationName)) {
        for {
          unfinishedUploads <- dsRemoteWebknossosClient.getUnfinishedUploadsForUser(organizationName)
          unfinishedUploadsWithUploadIds <- Fox.fromFuture(
            uploadService.addUploadIdsToUnfinishedUploads(unfinishedUploads))
          unfinishedUploadsWithUploadIdsWithoutDataSourceId = unfinishedUploadsWithUploadIds.map(_.withoutDataSourceId)
        } yield Ok(Json.toJson(unfinishedUploadsWithUploadIdsWithoutDataSourceId))
      }
    }

  // To be called by people with disk access but not DatasetManager role. This way, they can upload a dataset manually on disk,
  // and it can be put in a webknossos folder where they have access
  def reserveManualUpload(): Action[ReserveManualUploadInformation] =
    Action.async(validateJson[ReserveManualUploadInformation]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDataSources(request.body.organization)) {
        for {
          reservedDatasetInfo <- dsRemoteWebknossosClient.reserveDataSourceUpload(
            ReserveUploadInformation(
              "aManualUpload",
              request.body.datasetName,
              request.body.organization,
              0,
              Some(List.empty),
              None,
              None,
              request.body.initialTeamIds,
              request.body.folderId,
              Some(request.body.requireUniqueName)
            )
          ) ?~> "dataset.upload.validation.failed"
        } yield
          Ok(
            Json.obj("newDatasetId" -> reservedDatasetInfo.newDatasetId,
                     "directoryName" -> reservedDatasetInfo.directoryName))
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
  def uploadChunk(): Action[MultipartFormData[Files.TemporaryFile]] =
    Action.async(parse.multipartFormData) { implicit request =>
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
                dataSourceId <- uploadService.getDataSourceIdByUploadId(
                  uploadService.extractDatasetUploadId(uploadFileId)) ?~> "dataset.upload.validation.failed"
                result <- accessTokenService.validateAccessFromTokenContext(
                  UserAccessRequest.writeDataSource(dataSourceId)) {
                  for {
                    isKnownUpload <- uploadService.isKnownUploadByFileId(uploadFileId)
                    _ <- Fox.fromBool(isKnownUpload) ?~> "dataset.upload.validation.failed"
                    chunkFile <- request.body.file("file").toFox ?~> "zip.file.notFound"
                    _ <- uploadService.handleUploadChunk(uploadFileId,
                                                         chunkSize,
                                                         currentChunkSize,
                                                         totalChunkCount,
                                                         chunkNumber,
                                                         new File(chunkFile.ref.path.toString))
                  } yield Ok
                }
              } yield result
          }
        )
    }

  def testChunk(resumableChunkNumber: Int, resumableIdentifier: String): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        dataSourceId <- uploadService.getDataSourceIdByUploadId(
          uploadService.extractDatasetUploadId(resumableIdentifier)) ?~> "dataset.upload.validation.failed"
        result <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataSource(dataSourceId)) {
          for {
            isKnownUpload <- uploadService.isKnownUploadByFileId(resumableIdentifier)
            _ <- Fox.fromBool(isKnownUpload) ?~> "dataset.upload.validation.failed"
            isPresent <- uploadService.isChunkPresent(resumableIdentifier, resumableChunkNumber)
          } yield if (isPresent) Ok else NoContent
        }
      } yield result
    }

  def finishUpload(): Action[UploadInformation] = Action.async(validateJson[UploadInformation]) { implicit request =>
    log() {
      for {
        dataSourceId <- uploadService
          .getDataSourceIdByUploadId(request.body.uploadId) ?~> "dataset.upload.validation.failed"
        response <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataSource(dataSourceId)) {
          for {
            (dataSourceId, datasetSizeBytes) <- uploadService
              .finishUpload(request.body) ?~> "dataset.upload.finishFailed"
            uploadedDatasetIdJson <- dsRemoteWebknossosClient.reportUpload(
              dataSourceId,
              datasetSizeBytes,
              request.body.needsConversion.getOrElse(false),
              viaAddRoute = false
            ) ?~> "reportUpload.failed"
          } yield Ok(Json.obj("newDatasetId" -> uploadedDatasetIdJson))
        }
      } yield response
    }
  }

  def cancelUpload(): Action[CancelUploadInformation] =
    Action.async(validateJson[CancelUploadInformation]) { implicit request =>
      val dataSourceIdFox = uploadService.isKnownUpload(request.body.uploadId).flatMap {
        case false => Fox.failure("dataset.upload.validation.failed")
        case true  => uploadService.getDataSourceIdByUploadId(request.body.uploadId)
      }
      dataSourceIdFox.flatMap { dataSourceId =>
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.deleteDataSource(dataSourceId)) {
          for {
            _ <- dsRemoteWebknossosClient.deleteDataSource(dataSourceId) ?~> "dataset.delete.webknossos.failed"
            _ <- uploadService.cancelUpload(request.body) ?~> "Could not cancel the upload."
          } yield Ok
        }
      }
    }

  def listMappings(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContextForSyncBlock(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      addNoCacheHeaderFallback(
        Ok(Json.toJson(dataSourceService.exploreMappings(organizationId, datasetDirectoryName, dataLayerName))))
    }
  }

  def listAgglomerates(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName)
        agglomerateList = agglomerateService.listAgglomeratesFiles(dataSource.id, dataLayer)
      } yield Ok(Json.toJson(agglomerateList))
    }
  }

  def generateAgglomerateSkeleton(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName)
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        skeleton <- agglomerateService
          .generateSkeleton(agglomerateFileKey, agglomerateId) ?~> "agglomerateSkeleton.failed"
      } yield Ok(skeleton.toByteArray).as(protobufMimeType)
    }
  }

  def agglomerateGraph(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName)
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        agglomerateGraph <- agglomerateService
          .generateAgglomerateGraph(agglomerateFileKey, agglomerateId) ?~> "agglomerateGraph.failed"
      } yield Ok(agglomerateGraph.toByteArray).as(protobufMimeType)
    }
  }

  def positionForSegmentViaAgglomerateFile(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mappingName: String,
      segmentId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName)
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        position <- agglomerateService
          .positionForSegmentId(agglomerateFileKey, segmentId) ?~> "getSegmentPositionFromAgglomerateFile.failed"
      } yield Ok(Json.toJson(position))
    }
  }

  def largestAgglomerateId(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName)
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        largestAgglomerateId: Long <- agglomerateService.largestAgglomerateId(agglomerateFileKey)
      } yield Ok(Json.toJson(largestAgglomerateId))
    }
  }

  def agglomerateIdsForSegmentIds(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[ListOfLong] = Action.async(validateProto[ListOfLong]) { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName)
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        agglomerateIds: Seq[Long] <- agglomerateService.agglomerateIdsForSegmentIds(
          agglomerateFileKey,
          request.body.items
        )
      } yield Ok(ListOfLong(agglomerateIds).toByteArray)
    }
  }

  def update(organizationId: String, datasetDirectoryName: String): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.writeDataSource(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          dataSource <- dataSourceRepository.get(DataSourceId(datasetDirectoryName, organizationId)).toFox ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND
          _ <- dataSourceService.updateDataSource(request.body.copy(id = dataSource.id), expectExisting = true)
        } yield Ok
      }
    }

  // Stores a remote dataset in the database.
  def add(organizationId: String, datasetName: String, folderId: Option[String]): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.administrateDataSources) {
        for {
          reservedAdditionalInfo <- dsRemoteWebknossosClient.reserveDataSourceUpload(
            ReserveUploadInformation(
              uploadId = "", // Set by core backend
              name = datasetName,
              organization = organizationId,
              totalFileCount = 1,
              filePaths = None,
              totalFileSizeInBytes = None,
              layersToLink = None,
              initialTeams = List.empty,
              folderId = folderId,
              requireUniqueName = Some(false),
            )
          ) ?~> "dataset.upload.validation.failed"
          datasourceId = DataSourceId(reservedAdditionalInfo.directoryName, organizationId)
          _ <- dataSourceService.updateDataSource(request.body.copy(id = datasourceId), expectExisting = false)
          uploadedDatasetId <- dsRemoteWebknossosClient.reportUpload(datasourceId,
                                                                     0L,
                                                                     needsConversion = false,
                                                                     viaAddRoute = true) ?~> "reportUpload.failed"
        } yield Ok(Json.obj("newDatasetId" -> uploadedDatasetId))
      }
    }

  def createOrganizationDirectory(organizationId: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContextForSyncBlock(
      UserAccessRequest.administrateDataSources(organizationId)) {
      val newOrganizationDirectory = new File(f"${dataSourceService.dataBaseDir}/$organizationId")
      newOrganizationDirectory.mkdirs()
      if (newOrganizationDirectory.isDirectory)
        Ok
      else
        BadRequest
    }
  }

  def measureUsedStorage(organizationId: String, datasetDirectoryName: Option[String] = None): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.administrateDataSources(organizationId)) {
          for {
            before <- Instant.nowFox
            usedStorageInBytes: List[DirectoryStorageReport] <- storageUsageService.measureStorage(organizationId,
                                                                                                   datasetDirectoryName)
            _ = if (Instant.since(before) > (10 seconds)) {
              val datasetLabel = datasetDirectoryName.map(n => s" dataset $n of").getOrElse("")
              Instant.logSince(before, s"Measuring storage for$datasetLabel orga $organizationId", logger)
            }
          } yield Ok(Json.toJson(usedStorageInBytes))
        }
      }
    }

  private def clearCachesOfDataSource(organizationId: String,
                                      datasetDirectoryName: String,
                                      layerName: Option[String]): InboxDataSource = {
    val dataSourceId = DataSourceId(datasetDirectoryName, organizationId)
    val (closedAgglomerateFileHandleCount, clearedBucketProviderCount, removedChunksCount) =
      binaryDataServiceHolder.binaryDataService.clearCache(organizationId, datasetDirectoryName, layerName)
    val closedMeshFileHandleCount =
      meshFileService.clearCache(dataSourceId, layerName)
    val closedSegmentIndexFileHandleCount =
      segmentIndexFileService.clearCache(dataSourceId, layerName)
    val closedConnectomeFileHandleCount =
      connectomeFileService.clearCache(dataSourceId, layerName)
    val reloadedDataSource: InboxDataSource = dataSourceService.dataSourceFromDir(
      dataSourceService.dataBaseDir.resolve(organizationId).resolve(datasetDirectoryName),
      organizationId)
    datasetErrorLoggingService.clearForDataset(organizationId, datasetDirectoryName)
    val clearedVaultCacheEntriesOpt = dataSourceService.invalidateVaultCache(reloadedDataSource, layerName)
    clearedVaultCacheEntriesOpt.foreach { clearedVaultCacheEntries =>
      logger.info(
        s"Cleared caches for ${layerName.map(l => s"layer '$l' of ").getOrElse("")}dataset $organizationId/$datasetDirectoryName: closed $closedAgglomerateFileHandleCount agglomerate file handles, $closedMeshFileHandleCount mesh file handles, $closedSegmentIndexFileHandleCount segment index file handles, $closedConnectomeFileHandleCount connectome file handles, removed $clearedBucketProviderCount bucketProviders, $clearedVaultCacheEntries vault cache entries and $removedChunksCount image chunk cache entries.")
    }
    reloadedDataSource
  }

  def reload(organizationId: String,
             datasetDirectoryName: String,
             layerName: Option[String] = None): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.administrateDataSources(organizationId)) {
        val reloadedDataSource = clearCachesOfDataSource(organizationId, datasetDirectoryName, layerName)
        for {
          _ <- dataSourceRepository.updateDataSource(reloadedDataSource)
        } yield Ok(Json.toJson(reloadedDataSource))
      }
    }

  def deleteOnDisk(organizationId: String, datasetDirectoryName: String): Action[AnyContent] =
    Action.async { implicit request =>
      val dataSourceId = DataSourceId(datasetDirectoryName, organizationId)
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.deleteDataSource(dataSourceId)) {
        tryo(clearCachesOfDataSource(organizationId, datasetDirectoryName, None))
        for {
          _ <- dataSourceService.deleteOnDisk(
            organizationId,
            datasetDirectoryName,
            reason = Some("the user wants to delete the dataset")) ?~> "dataset.delete.failed"
          _ <- dataSourceRepository.removeDataSource(dataSourceId) // also frees the name in the wk-side database
        } yield Ok
      }
    }

  def compose(): Action[ComposeRequest] =
    Action.async(validateJson[ComposeRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDataSources(request.body.organizationId)) {
        for {
          _ <- Fox.serialCombined(request.body.layers.map(_.dataSourceId).toList)(id =>
            accessTokenService.assertUserAccess(UserAccessRequest.readDataSources(id)))
          (dataSource, newDatasetId) <- composeService.composeDataset(request.body)
          _ <- dataSourceRepository.updateDataSource(dataSource)
        } yield Ok(Json.obj("newDatasetId" -> newDatasetId))
      }
    }

  def listConnectomeFiles(organizationId: String,
                          datasetDirectoryName: String,
                          dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName)
          connectomeFileInfos <- connectomeFileService.listConnectomeFiles(dataSource.id, dataLayer)
        } yield Ok(Json.toJson(connectomeFileInfos))
      }
    }

  def getSynapsesForAgglomerates(organizationId: String,
                                 datasetDirectoryName: String,
                                 dataLayerName: String): Action[ByAgglomerateIdsRequest] =
    Action.async(validateJson[ByAgglomerateIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName)
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(dataSource.id,
                                                                       dataLayer,
                                                                       request.body.connectomeFile)
          synapses <- connectomeFileService.synapsesForAgglomerates(meshFileKey, request.body.agglomerateIds)
        } yield Ok(Json.toJson(synapses))
      }
    }

  def getSynapticPartnerForSynapses(organizationId: String,
                                    datasetDirectoryName: String,
                                    dataLayerName: String,
                                    direction: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          directionValidated <- SynapticPartnerDirection
            .fromString(direction)
            .toFox ?~> "could not parse synaptic partner direction"
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName)
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(dataSource.id,
                                                                       dataLayer,
                                                                       request.body.connectomeFile)
          agglomerateIds <- connectomeFileService.synapticPartnerForSynapses(meshFileKey,
                                                                             request.body.synapseIds,
                                                                             directionValidated)
        } yield Ok(Json.toJson(agglomerateIds))
      }
    }

  def getSynapsePositions(organizationId: String,
                          datasetDirectoryName: String,
                          dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName)
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(dataSource.id,
                                                                       dataLayer,
                                                                       request.body.connectomeFile)
          synapsePositions <- connectomeFileService.positionsForSynapses(meshFileKey, request.body.synapseIds)
        } yield Ok(Json.toJson(synapsePositions))
      }
    }

  def getSynapseTypes(organizationId: String,
                      datasetDirectoryName: String,
                      dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName)
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(dataSource.id,
                                                                       dataLayer,
                                                                       request.body.connectomeFile)
          synapseTypes <- connectomeFileService.typesForSynapses(meshFileKey, request.body.synapseIds)
        } yield Ok(Json.toJson(synapseTypes))
      }
    }

  def checkSegmentIndexFile(organizationId: String,
                            datasetDirectoryName: String,
                            dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName)
          segmentIndexFileKeyBox <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, dataLayer).shiftBox
        } yield Ok(Json.toJson(segmentIndexFileKeyBox.isDefined))
      }
    }

  /**
    * Query the segment index file for a single segment
    *
    * @return List of bucketPositions as positions (not indices) of 32³ buckets in mag
    */
  def getSegmentIndex(organizationId: String,
                      datasetDirectoryName: String,
                      dataLayerName: String,
                      segmentId: String): Action[GetSegmentIndexParameters] =
    Action.async(validateJson[GetSegmentIndexParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName)
          segmentIndexFileKey <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, dataLayer)
          segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
            dataSource.id,
            dataLayer,
            request.body.mappingName,
            request.body.editableMappingTracingId,
            segmentId.toLong,
            mappingNameForMeshFile = None,
            omitMissing = false
          )
          topLeftsNested: Seq[Array[Vec3Int]] <- Fox.serialCombined(segmentIds)(sId =>
            segmentIndexFileService.readSegmentIndex(segmentIndexFileKey, sId))
          topLefts: Array[Vec3Int] = topLeftsNested.toArray.flatten
          bucketPositions = segmentIndexFileService.topLeftsToDistinctTargetMagBucketPositions(topLefts,
                                                                                               request.body.mag)
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
    *
    * @return List of bucketPositions as indices of 32³ buckets (in target mag)
    */
  def querySegmentIndex(organizationId: String,
                        datasetDirectoryName: String,
                        dataLayerName: String): Action[GetMultipleSegmentIndexParameters] =
    Action.async(validateJson[GetMultipleSegmentIndexParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName)
          segmentIndexFileKey <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, dataLayer)
          segmentIdsAndBucketPositions <- Fox.serialCombined(request.body.segmentIds) { segmentOrAgglomerateId =>
            for {
              segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
                dataSource.id,
                dataLayer,
                request.body.mappingName,
                request.body.editableMappingTracingId,
                segmentOrAgglomerateId,
                mappingNameForMeshFile = None,
                omitMissing = true // assume agglomerate ids not present in the mapping belong to user-brushed segments
              )
              topLeftsNested: Seq[Array[Vec3Int]] <- Fox.serialCombined(segmentIds)(sId =>
                segmentIndexFileService.readSegmentIndex(segmentIndexFileKey, sId))
              topLefts: Array[Vec3Int] = topLeftsNested.toArray.flatten
              bucketPositions = segmentIndexFileService.topLeftsToDistinctTargetMagBucketPositions(topLefts,
                                                                                                   request.body.mag)
            } yield SegmentIndexData(segmentOrAgglomerateId, bucketPositions.toSeq)
          }
        } yield Ok(Json.toJson(segmentIdsAndBucketPositions))
      }
    }

  def getSegmentVolume(organizationId: String,
                       datasetDirectoryName: String,
                       dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName)
          segmentIndexFileKey <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, dataLayer)
          agglomerateFileKeyOpt <- Fox.runOptional(request.body.mappingName)(
            agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, _))
          volumes <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            segmentIndexFileService.getSegmentVolume(
              dataSource.id,
              dataLayer,
              segmentIndexFileKey,
              agglomerateFileKeyOpt,
              segmentId,
              request.body.mag
            )
          }
        } yield Ok(Json.toJson(volumes))
      }
    }

  def getSegmentBoundingBox(organizationId: String,
                            datasetDirectoryName: String,
                            dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName)
          segmentIndexFileKey <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, dataLayer)
          agglomerateFileKeyOpt <- Fox.runOptional(request.body.mappingName)(
            agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, _))
          boxes <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            segmentIndexFileService.getSegmentBoundingBox(dataSource.id,
                                                          dataLayer,
                                                          segmentIndexFileKey,
                                                          agglomerateFileKeyOpt,
                                                          segmentId,
                                                          request.body.mag)
          }
        } yield Ok(Json.toJson(boxes))
      }
    }

  // Called directly by wk side
  def exploreRemoteDataset(): Action[ExploreRemoteDatasetRequest] =
    Action.async(validateJson[ExploreRemoteDatasetRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDataSources(request.body.organizationId)) {
        val reportMutable = ListBuffer[String]()
        val hasLocalFilesystemRequest = request.body.layerParameters.exists(param =>
          new URI(param.remoteUri).getScheme == DataVaultService.schemeFile)
        for {
          dataSourceBox: Box[GenericDataSource[DataLayer]] <- exploreRemoteLayerService
            .exploreRemoteDatasource(request.body.layerParameters, reportMutable)
            .futureBox
          // Remove report of recursive exploration in case of exploring the local file system to avoid information exposure.
          _ <- Fox.runIf(hasLocalFilesystemRequest)(Fox.successful(reportMutable.clear()))
          dataSourceOpt = dataSourceBox match {
            case Full(dataSource) if dataSource.dataLayers.nonEmpty =>
              reportMutable += s"Resulted in dataSource with ${dataSource.dataLayers.length} layers."
              Some(dataSource)
            case Full(_) =>
              reportMutable += "Error when exploring as layer set: Resulted in zero layers."
              None
            case f: Failure =>
              reportMutable += s"Error when exploring as layer set: ${formatFailureChain(f, includeStackTraces = true, messagesProviderOpt = Some(request.messages))}"
              None
            case Empty =>
              reportMutable += "Error when exploring as layer set: Empty"
              None
          }
        } yield Ok(Json.toJson(ExploreRemoteDatasetResponse(dataSourceOpt, reportMutable.mkString("\n"))))
      }
    }

  def invalidateCache(datasetId: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
      datasetCache.invalidateCache(datasetId)
      Future.successful(Ok)
    }
  }

}
