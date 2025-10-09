package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Box, Empty, Failure, Fox, FoxImplicits, Full}
import com.scalableminds.webknossos.datastore.ListOfLong.ListOfLong
import com.scalableminds.webknossos.datastore.explore.{
  ExploreRemoteDatasetRequest,
  ExploreRemoteDatasetResponse,
  ExploreRemoteLayerService
}
import com.scalableminds.webknossos.datastore.helpers.{
  GetMultipleSegmentIndexParameters,
  GetSegmentIndexParameters,
  PathSchemes,
  SegmentIndexData,
  SegmentStatisticsParameters,
  UPath
}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, UsableDataSource}
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.services.connectome.ConnectomeFileService
import com.scalableminds.webknossos.datastore.services.mesh.{MeshFileService, MeshMappingHelper}
import com.scalableminds.webknossos.datastore.services.segmentindex.SegmentIndexFileService
import com.scalableminds.webknossos.datastore.services.uploading._
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.scalableminds.webknossos.datastore.services.connectome.{
  ByAgglomerateIdsRequest,
  BySynapseIdsRequest,
  SynapticPartnerDirection
}
import com.scalableminds.webknossos.datastore.services.mapping.AgglomerateService
import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService
import play.api.data.Form
import play.api.data.Forms.{longNumber, nonEmptyText, number, tuple}
import play.api.i18n.Messages
import play.api.libs.Files
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}

import java.io.File
import java.net.URI
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

case class PathValidationResult(
    path: UPath,
    valid: Boolean
)

object PathValidationResult {
  implicit val jsonFormat: OFormat[PathValidationResult] = Json.format[PathValidationResult]
}

class DataSourceController @Inject()(
    dataSourceService: DataSourceService,
    datasetCache: DatasetCache,
    accessTokenService: DataStoreAccessTokenService,
    val binaryDataServiceHolder: BinaryDataServiceHolder,
    connectomeFileService: ConnectomeFileService,
    segmentIndexFileService: SegmentIndexFileService,
    agglomerateService: AgglomerateService,
    storageUsageService: DSUsedStorageService,
    slackNotificationService: DSSlackNotificationService,
    datasetErrorLoggingService: DSDatasetErrorLoggingService,
    exploreRemoteLayerService: ExploreRemoteLayerService,
    uploadService: UploadService,
    meshFileService: MeshFileService,
    remoteSourceDescriptorService: RemoteSourceDescriptorService,
    val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
    val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller
    with MeshMappingHelper
    with FoxImplicits {

  override def allowRemoteOrigin: Boolean = true

  def triggerInboxCheckBlocking(organizationId: Option[String]): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      organizationId
        .map(id => UserAccessRequest.administrateDataSources(id))
        .getOrElse(UserAccessRequest.administrateDataSources)) {
      for {
        _ <- dataSourceService.checkInbox(verbose = true, organizationId = organizationId)
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
            for {
              reserveUploadAdditionalInfo <- dsRemoteWebknossosClient.reserveDataSourceUpload(request.body) ?~> "dataset.upload.validation.failed"
              _ <- uploadService.reserveUpload(request.body, reserveUploadAdditionalInfo)
            } yield ()
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
                datasetId <- uploadService
                  .getDatasetIdByUploadId(uploadService.extractDatasetUploadId(uploadFileId)) ?~> "dataset.upload.validation.failed"
                result <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
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
        datasetId <- uploadService.getDatasetIdByUploadId(uploadService.extractDatasetUploadId(resumableIdentifier)) ?~> "dataset.upload.validation.failed"
        result <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
          for {
            isKnownUpload <- uploadService.isKnownUploadByFileId(resumableIdentifier)
            _ <- Fox.fromBool(isKnownUpload) ?~> "dataset.upload.validation.failed"
            isPresent <- uploadService.isChunkPresent(resumableIdentifier, resumableChunkNumber)
          } yield if (isPresent) Ok else NoContent
        }
      } yield result
    }

  def finishUpload(): Action[UploadInformation] = Action.async(validateJson[UploadInformation]) { implicit request =>
    log(Some(slackNotificationService.noticeFailedFinishUpload)) {
      logTime(slackNotificationService.noticeSlowRequest) {
        for {
          datasetId <- uploadService
            .getDatasetIdByUploadId(request.body.uploadId) ?~> "dataset.upload.validation.failed"
          response <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
            for {
              _ <- uploadService.finishUpload(request.body, datasetId) ?~> Messages("dataset.upload.finishFailed",
                                                                                    datasetId)
            } yield Ok(Json.obj("newDatasetId" -> datasetId))
          }
        } yield response
      }
    }
  }

  def cancelUpload(): Action[CancelUploadInformation] =
    Action.async(validateJson[CancelUploadInformation]) { implicit request =>
      val datasetIdFox = uploadService.isKnownUpload(request.body.uploadId).flatMap {
        case false => Fox.failure("dataset.upload.validation.failed")
        case true  => uploadService.getDatasetIdByUploadId(request.body.uploadId)
      }
      datasetIdFox.flatMap { datasetId =>
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.deleteDataset(datasetId)) {
          for {
            _ <- dsRemoteWebknossosClient.deleteDataset(datasetId) ?~> "dataset.delete.webknossos.failed"
            _ <- uploadService.cancelUpload(request.body) ?~> "Could not cancel the upload."
          } yield Ok
        }
      }
    }

  def listMappings(
      datasetId: ObjectId,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        dataSource <- datasetCache.getById(datasetId)
        dataSourceId = dataSource.id // We would ideally want to use datasetId here as well, but mappings are not accessed by datasetId yet.
        exploredMappings = dataSourceService.exploreMappings(dataSourceId.organizationId,
                                                             dataSourceId.directoryName,
                                                             dataLayerName)
      } yield addNoCacheHeaderFallback(Ok(Json.toJson(exploredMappings)))
    }
  }

  def listAgglomerates(
      datasetId: ObjectId,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (_, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        agglomerateList = agglomerateService.listAgglomeratesFiles(dataLayer)
      } yield Ok(Json.toJson(agglomerateList))
    }
  }

  def generateAgglomerateSkeleton(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        skeleton <- agglomerateService
          .generateSkeleton(agglomerateFileKey, agglomerateId) ?~> "agglomerateSkeleton.failed"
      } yield Ok(skeleton.toByteArray).as(protobufMimeType)
    }
  }

  def agglomerateGraph(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        agglomerateGraph <- agglomerateService
          .generateAgglomerateGraph(agglomerateFileKey, agglomerateId) ?~> "agglomerateGraph.failed"
      } yield Ok(agglomerateGraph.toByteArray).as(protobufMimeType)
    }
  }

  def positionForSegmentViaAgglomerateFile(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String,
      segmentId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        position <- agglomerateService
          .positionForSegmentId(agglomerateFileKey, segmentId) ?~> "getSegmentPositionFromAgglomerateFile.failed"
      } yield Ok(Json.toJson(position))
    }
  }

  def largestAgglomerateId(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        largestAgglomerateId: Long <- agglomerateService.largestAgglomerateId(agglomerateFileKey)
      } yield Ok(Json.toJson(largestAgglomerateId))
    }
  }

  def agglomerateIdsForSegmentIds(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String
  ): Action[ListOfLong] = Action.async(validateProto[ListOfLong]) { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        agglomerateIds: Seq[Long] <- agglomerateService.agglomerateIdsForSegmentIds(
          agglomerateFileKey,
          request.body.items
        )
      } yield Ok(ListOfLong(agglomerateIds).toByteArray)
    }
  }

  def updateOnDisk(datasetId: ObjectId): Action[UsableDataSource] =
    Action.async(validateJson[UsableDataSource]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
        for {
          _ <- dataSourceService.updateDataSourceOnDisk(request.body, expectExisting = true, validate = true)
          _ = datasetCache.invalidateCache(datasetId)
        } yield Ok
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

  def measureUsedStorage(organizationId: String): Action[PathStorageUsageRequest] =
    Action.async(validateJson[PathStorageUsageRequest]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            before <- Instant.nowFox
            pathStorageReports <- storageUsageService.measureStorageForPaths(request.body.paths, organizationId)
            _ = if (Instant.since(before) > (10 seconds)) {
              Instant.logSince(before,
                               s"Measuring storage for orga $organizationId for ${request.body.paths.length} paths.",
                               logger)
            }
          } yield Ok(Json.toJson(PathStorageUsageResponse(reports = pathStorageReports)))
        }
      }
    }

  private def clearCachesOfDataSource(dataSource: DataSource, layerName: Option[String]): Unit = {
    val dataSourceId = dataSource.id
    val organizationId = dataSourceId.organizationId
    val datasetDirectoryName = dataSourceId.directoryName
    val (closedAgglomerateFileHandleCount, clearedBucketProviderCount, removedChunksCount) =
      binaryDataServiceHolder.binaryDataService.clearCache(organizationId, datasetDirectoryName, layerName)
    val closedMeshFileHandleCount =
      meshFileService.clearCache(dataSourceId, layerName)
    val closedSegmentIndexFileHandleCount =
      segmentIndexFileService.clearCache(dataSourceId, layerName)
    val closedConnectomeFileHandleCount =
      connectomeFileService.clearCache(dataSourceId, layerName)
    datasetErrorLoggingService.clearForDataset(organizationId, datasetDirectoryName)
    val clearedVaultCacheEntriesOpt = dataSourceService.invalidateVaultCache(dataSource, layerName)
    clearedVaultCacheEntriesOpt.foreach { clearedVaultCacheEntries =>
      logger.info(
        s"Cleared caches for ${layerName.map(l => s"layer '$l' of ").getOrElse("")}dataset $organizationId/$datasetDirectoryName: closed $closedAgglomerateFileHandleCount agglomerate file handles, $closedMeshFileHandleCount mesh file handles, $closedSegmentIndexFileHandleCount segment index file handles, $closedConnectomeFileHandleCount connectome file handles, removed $clearedBucketProviderCount bucketProviders, $clearedVaultCacheEntries vault cache entries and $removedChunksCount image chunk cache entries.")
    }
  }

  def reload(organizationId: String, datasetId: ObjectId, layerName: Option[String] = None): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.administrateDataSources(organizationId)) {
        for {
          dataSource <- dsRemoteWebknossosClient.getDataSource(datasetId) ~> NOT_FOUND
          _ = clearCachesOfDataSource(dataSource, layerName)
          reloadedDataSource <- refreshDataSource(datasetId)
        } yield Ok(Json.toJson(reloadedDataSource))
      }
    }

  // TODO should not be a datastore route, have wk call this here
  def deleteOnDisk(datasetId: ObjectId): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.deleteDataset(datasetId)) {
        for {
          dataSource <- datasetCache.getById(datasetId) ~> NOT_FOUND
          dataSourceId = dataSource.id
          _ <- if (dataSourceService.existsOnDisk(dataSourceId)) {
            for {
              _ <- dataSourceService.deleteOnDisk(
                dataSourceId.organizationId,
                dataSourceId.directoryName,
                Some(datasetId),
                reason = Some("the user wants to delete the dataset")) ?~> "dataset.delete.failed"
            } yield ()
          } else
            for {
              _ <- Fox.runIf(dataSourceService.datasetInControlledS3(dataSource))(
                dataSourceService.deleteFromControlledS3(dataSource, datasetId))
              _ = logger.warn(s"Tried to delete dataset ${dataSource.id} ($datasetId), but is not present on disk.")
            } yield ()
          _ <- dsRemoteWebknossosClient.deleteDataset(datasetId)
        } yield Ok
      }
    }

  def listConnectomeFiles(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          connectomeFileInfos <- connectomeFileService.listConnectomeFiles(dataSource.id, dataLayer)
        } yield Ok(Json.toJson(connectomeFileInfos))
      }
    }

  def getSynapsesForAgglomerates(datasetId: ObjectId, dataLayerName: String): Action[ByAgglomerateIdsRequest] =
    Action.async(validateJson[ByAgglomerateIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(dataSource.id,
                                                                       dataLayer,
                                                                       request.body.connectomeFile)
          synapses <- connectomeFileService.synapsesForAgglomerates(meshFileKey, request.body.agglomerateIds)
        } yield Ok(Json.toJson(synapses))
      }
    }

  def getSynapticPartnerForSynapses(datasetId: ObjectId,
                                    dataLayerName: String,
                                    direction: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          directionValidated <- SynapticPartnerDirection
            .fromString(direction)
            .toFox ?~> "could not parse synaptic partner direction"
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(dataSource.id,
                                                                       dataLayer,
                                                                       request.body.connectomeFile)
          agglomerateIds <- connectomeFileService.synapticPartnerForSynapses(meshFileKey,
                                                                             request.body.synapseIds,
                                                                             directionValidated)
        } yield Ok(Json.toJson(agglomerateIds))
      }
    }

  def getSynapsePositions(datasetId: ObjectId, dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(dataSource.id,
                                                                       dataLayer,
                                                                       request.body.connectomeFile)
          synapsePositions <- connectomeFileService.positionsForSynapses(meshFileKey, request.body.synapseIds)
        } yield Ok(Json.toJson(synapsePositions))
      }
    }

  def getSynapseTypes(datasetId: ObjectId, dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(dataSource.id,
                                                                       dataLayer,
                                                                       request.body.connectomeFile)
          synapseTypes <- connectomeFileService.typesForSynapses(meshFileKey, request.body.synapseIds)
        } yield Ok(Json.toJson(synapseTypes))
      }
    }

  def checkSegmentIndexFile(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          segmentIndexFileKeyBox <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, dataLayer).shiftBox
        } yield Ok(Json.toJson(segmentIndexFileKeyBox.isDefined))
      }
    }

  /**
    * Query the segment index file for a single segment
    *
    * @return List of bucketPositions as positions (not indices) of 32³ buckets in mag
    */
  def getSegmentIndex(datasetId: ObjectId,
                      dataLayerName: String,
                      segmentId: String): Action[GetSegmentIndexParameters] =
    Action.async(validateJson[GetSegmentIndexParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
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
  def querySegmentIndex(datasetId: ObjectId, dataLayerName: String): Action[GetMultipleSegmentIndexParameters] =
    Action.async(validateJson[GetMultipleSegmentIndexParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
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

  def getSegmentVolume(datasetId: ObjectId, dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
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

  def getSegmentBoundingBox(datasetId: ObjectId, dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
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
        val hasLocalFilesystemRequest =
          request.body.layerParameters.exists(param => new URI(param.remoteUri).getScheme == PathSchemes.schemeFile)
        for {
          dataSourceBox: Box[UsableDataSource] <- exploreRemoteLayerService
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

  def validatePaths(): Action[List[UPath]] =
    Action.async(validateJson[List[UPath]]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
        for {
          _ <- Fox.successful(())
          pathsAllowed = request.body.map(remoteSourceDescriptorService.pathIsAllowedToAddDirectly)
          result = request.body.zip(pathsAllowed).map {
            case (path, isAllowed) => PathValidationResult(path, isAllowed)
          }
        } yield Ok(Json.toJson(result))
      }
    }

  def invalidateCache(datasetId: ObjectId): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
      datasetCache.invalidateCache(datasetId)
      Future.successful(Ok)
    }
  }

  private def refreshDataSource(datasetId: ObjectId)(implicit tc: TokenContext): Fox[DataSource] =
    for {
      dataSourceFromDB <- dsRemoteWebknossosClient.getDataSource(datasetId) ~> NOT_FOUND
      dataSourceId = dataSourceFromDB.id
      dataSourceFromDirOpt = if (dataSourceService.existsOnDisk(dataSourceId)) {
        Some(
          dataSourceService.dataSourceFromDir(
            dataSourceService.dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName),
            dataSourceId.organizationId))
      } else None
      _ <- Fox.runOptional(dataSourceFromDirOpt)(ds => dsRemoteWebknossosClient.updateDataSource(ds, datasetId))
      _ = datasetCache.invalidateCache(datasetId)
      newUsableFromDBBox <- datasetCache.getById(datasetId).shiftBox
      dataSourceToReturn <- (newUsableFromDBBox, dataSourceFromDirOpt) match {
        case (Full(newUsableFromDB), _)   => Fox.successful(newUsableFromDB)
        case (_, Some(dataSourceFromDir)) => Fox.successful(dataSourceFromDir)
        case _                            => Fox.failure("DataSource not found") ~> NOT_FOUND
      }
    } yield dataSourceToReturn

}
