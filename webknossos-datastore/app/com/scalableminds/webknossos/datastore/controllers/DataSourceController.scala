package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.ListOfLong.ListOfLong
import com.scalableminds.webknossos.datastore.explore.{
  ExploreRemoteDatasetRequest,
  ExploreRemoteDatasetResponse,
  ExploreRemoteLayerService
}
import com.scalableminds.webknossos.datastore.helpers.{LocalDatasetDeletionService, PathSchemes, UPath}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, UsableDataSource}
import com.scalableminds.webknossos.datastore.services.*
import com.scalableminds.webknossos.datastore.services.connectome.ConnectomeFileService
import com.scalableminds.webknossos.datastore.services.mesh.{DSFullMeshService, MeshFileService}
import com.scalableminds.webknossos.datastore.services.segmentindex.SegmentIndexFileService
import com.scalableminds.webknossos.datastore.services.segmentstatistics.SegmentStatisticsFileService
import com.scalableminds.webknossos.datastore.services.connectome.{
  ByAgglomerateIdsRequest,
  BySynapseIdsRequest,
  SynapticPartnerDirection
}
import com.scalableminds.webknossos.datastore.services.mapping.{AgglomerateService, MappingService}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import java.net.URI
import java.nio.file.Path
import java.nio.file.Files
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration.*
import scala.concurrent.ExecutionContext

case class PathValidationResult(
    path: UPath,
    valid: Boolean
)

object PathValidationResult {
  implicit val jsonFormat: OFormat[PathValidationResult] = Json.format[PathValidationResult]
}

class DataSourceController @Inject() (
    dataSourceService: DataSourceService,
    dataSourceMirrorService: DataSourceMirrorService,
    datasetCache: DatasetCache,
    mappingService: MappingService,
    dataStoreConfig: DataStoreConfig,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    connectomeFileService: ConnectomeFileService,
    segmentIndexFileService: SegmentIndexFileService,
    segmentStatisticsFileService: SegmentStatisticsFileService,
    agglomerateService: AgglomerateService,
    storageUsageService: DSUsedStorageService,
    datasetErrorLoggingService: DSDatasetErrorLoggingService,
    exploreRemoteLayerService: ExploreRemoteLayerService,
    fullMeshService: DSFullMeshService,
    baseDirService: BaseDirService,
    managedS3Service: ManagedS3Service,
    meshFileService: MeshFileService,
    localDatasetDeletionService: LocalDatasetDeletionService,
    dataVaultService: DataVaultService,
    dsRemoteWebknossosClient: DSRemoteWebknossosClient
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller {

  override def allowRemoteOrigin: Boolean = true

  def getOneBaseDirForOrgaAbsolute(organizationId: String): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
      for {
        orgaBaseDir <- baseDirService.getOneLocalForOrga(organizationId).toFox
      } yield Ok(Json.toJson(UPath.fromLocalPath(orgaBaseDir)))
    }
  }

  def scanBaseDirectories(organizationId: Option[String]): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      organizationId
        .map(id => UserAccessRequest.administrateDatasets(id))
        .getOrElse(UserAccessRequest.administrateDatasets)
    ) {
      for {
        _ <- dataSourceService.scanBaseDirectories(verbose = true, organizationId = organizationId)
      } yield Ok
    }
  }

  def scanRealPathsForVirtual(): Action[Seq[DataSourceWithRootPathInfo]] =
    Action.fox(validateJson[Seq[DataSourceWithRootPathInfo]]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
        for {
          _ <- dataSourceService.scanRealPathsForVirtual(request.body)
        } yield Ok
      }
    }

  def listMappings(
      datasetId: ObjectId,
      dataLayerName: String
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        dataSource <- datasetCache.getById(datasetId)
        _ <- dataSource.getDataLayer(dataLayerName).toFox ?~> Msg.Dataset.Layer.notFound(dataLayerName)
        rootPathBox <- dsRemoteWebknossosClient.getLocalRootPathOrEmpty(datasetId).shiftBox
        exploredMappings <- rootPathBox match {
          case Full(localRootPath) =>
            Fox.successful(mappingService.exploreMappings(localRootPath.resolve(dataLayerName)))
          case Empty      => Fox.successful(Seq.empty)
          case f: Failure => f.toFox
        }
      } yield addNoCacheHeaderFallback(Ok(Json.toJson(exploredMappings)))
    }
  }

  def listAgglomerates(
      datasetId: ObjectId,
      dataLayerName: String
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (_, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        agglomerateList = agglomerateService.listAgglomeratesFiles(dataLayer)
      } yield Ok(Json.toJson(agglomerateList))
    }
  }

  def generateAgglomerateTree(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        skeleton <- agglomerateService.generateTreeAsSkeleton(
          agglomerateFileKey,
          agglomerateId
        ) ?~> Msg.AgglomerateTree.failed
      } yield Ok(skeleton.toByteArray).as(protobufMimeType)
    }
  }

  def agglomerateGraph(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        agglomerateGraph <- agglomerateService.generateAgglomerateGraph(
          agglomerateFileKey,
          agglomerateId
        ) ?~> Msg.AgglomerateGraph.failed
      } yield Ok(agglomerateGraph.toByteArray).as(protobufMimeType)
    }
  }

  def positionForSegmentViaAgglomerateFile(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String,
      segmentId: Long
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, mappingName)
        position <- agglomerateService.positionForSegmentId(agglomerateFileKey, segmentId) ?~> Msg.AgglomerateFile
          .getSegmentPositionFailed(agglomerateFileKey.attachment.name)
      } yield Ok(Json.toJson(position))
    }
  }

  def largestAgglomerateId(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.fox { implicit request =>
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
  ): Action[ListOfLong] = Action.fox(validateProto[ListOfLong]) { implicit request =>
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

  def updateOnDisk(datasetId: ObjectId, rootPath: String): Action[UsableDataSource] =
    Action.fox(validateJson[UsableDataSource]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
        for {
          _ <- dataSourceService.updateDataSourceOnDisk(Path.of(rootPath), request.body)
          _ = datasetCache.invalidateCache(datasetId)
        } yield Ok
      }
    }

  def createOrganizationDirectory(organizationId: String): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.administrateDatasets(organizationId)
    ) {
      for {
        _ <- baseDirService.getOneLocalForOrga(organizationId, createIfMissing = true, checkWritable = true).toFox
      } yield Ok
    }
  }

  def measureUsedStorage(organizationId: String): Action[PathStorageUsageRequest] =
    Action.fox(validateJson[PathStorageUsageRequest]) { implicit request =>
      log() {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          for {
            before <- Instant.nowFox
            pathStorageReports <- storageUsageService.measureStorageForPaths(request.body.paths, organizationId)
            _ = if (Instant.since(before) > (10 seconds)) {
              Instant.logSince(
                before,
                s"Measuring storage for orga $organizationId for ${request.body.paths.length} paths.",
                logger
              )
            }
          } yield Ok(Json.toJson(PathStorageUsageResponse(reports = pathStorageReports)))
        }
      }
    }

  private def clearCachesOfDataSource(datasetId: ObjectId, dataSource: DataSource, layerName: Option[String]): Unit = {
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
    val closedSegmentStatisticsFileHandleCount =
      segmentStatisticsFileService.clearCache(dataSourceId, layerName)
    datasetErrorLoggingService.clearForDataset(organizationId, datasetDirectoryName)
    fullMeshService.clearCache(datasetId, layerName)
    val clearedVaultCacheEntriesOpt = dataSourceService.invalidateVaultCache(dataSource, layerName)
    clearedVaultCacheEntriesOpt.foreach { clearedVaultCacheEntries =>
      logger.info(
        s"Cleared caches for ${layerName.map(l => s"layer '$l' of ").getOrElse("")}dataset $organizationId/$datasetDirectoryName: closed $closedAgglomerateFileHandleCount agglomerate file handles, $closedMeshFileHandleCount mesh file handles, $closedSegmentIndexFileHandleCount segment index file handles, $closedConnectomeFileHandleCount connectome file handles, $closedSegmentStatisticsFileHandleCount segment statistics file handles, removed $clearedBucketProviderCount bucketProviders, $clearedVaultCacheEntries vault cache entries and $removedChunksCount image chunk cache entries."
      )
    }
  }

  def reload(organizationId: String, datasetId: ObjectId, layerName: Option[String] = None): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.administrateDatasets(organizationId)) {
        for {
          dataSource <- dsRemoteWebknossosClient.getDataSource(datasetId) ~> NOT_FOUND
          _ = clearCachesOfDataSource(datasetId, dataSource, layerName)
          reloadedDataSource <- refreshDataSource(datasetId)
        } yield Ok(Json.toJson(reloadedDataSource))
      }
    }

  def deleteOnDisk(datasetId: ObjectId, rootPath: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
        for {
          dataSource <- dsRemoteWebknossosClient.getDataSource(datasetId) ~> NOT_FOUND
          dataSourceId = dataSource.id
          _ <- localDatasetDeletionService
            .deleteOnDisk(
              datasetId,
              Path.of(rootPath),
              dataSourceId.organizationId,
              dataSourceId.directoryName,
              reason = Some("the user wants to delete the dataset")
            )
            .toFox ?~> Msg.Dataset.Delete.failed
        } yield Ok
      }
    }

  // Of the passed paths, it deletes the local ones from disk and returns those in managed S3
  def deletePaths(): Action[Seq[UPath]] =
    Action.fox(validateJson[Seq[UPath]]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
        for {
          _ <- dataSourceService.deleteLocalPathsFromDisk(request.body).toFox
        } yield Ok(Json.toJson(request.body.filter(managedS3Service.pathIsInManagedS3)))
      }
    }

  def listConnectomeFiles(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          connectomeFileInfos <- connectomeFileService.listConnectomeFiles(dataSource.id, dataLayer)
        } yield Ok(Json.toJson(connectomeFileInfos))
      }
    }

  def getSynapsesForAgglomerates(datasetId: ObjectId, dataLayerName: String): Action[ByAgglomerateIdsRequest] =
    Action.fox(validateJson[ByAgglomerateIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(
            dataSource.id,
            dataLayer,
            request.body.connectomeFile
          )
          synapses <- connectomeFileService.synapsesForAgglomerates(meshFileKey, request.body.agglomerateIds)
        } yield Ok(Json.toJson(synapses))
      }
    }

  def getSynapticPartnerForSynapses(
      datasetId: ObjectId,
      dataLayerName: String,
      direction: String
  ): Action[BySynapseIdsRequest] =
    Action.fox(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          directionValidated <- SynapticPartnerDirection
            .fromString(direction)
            .toFox ?~> "could not parse synaptic partner direction"
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(
            dataSource.id,
            dataLayer,
            request.body.connectomeFile
          )
          agglomerateIds <- connectomeFileService.synapticPartnerForSynapses(
            meshFileKey,
            request.body.synapseIds,
            directionValidated
          )
        } yield Ok(Json.toJson(agglomerateIds))
      }
    }

  def getSynapsePositions(datasetId: ObjectId, dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.fox(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(
            dataSource.id,
            dataLayer,
            request.body.connectomeFile
          )
          synapsePositions <- connectomeFileService.positionsForSynapses(meshFileKey, request.body.synapseIds)
        } yield Ok(Json.toJson(synapsePositions))
      }
    }

  def getSynapseTypes(datasetId: ObjectId, dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.fox(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- connectomeFileService.lookUpConnectomeFileKey(
            dataSource.id,
            dataLayer,
            request.body.connectomeFile
          )
          synapseTypes <- connectomeFileService.typesForSynapses(meshFileKey, request.body.synapseIds)
        } yield Ok(Json.toJson(synapseTypes))
      }
    }

  // Called directly by wk side
  def exploreRemoteDataset(): Action[ExploreRemoteDatasetRequest] =
    Action.fox(validateJson[ExploreRemoteDatasetRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDatasets(request.body.organizationId)
      ) {
        val reportMutable = ListBuffer[String]()
        val hasLocalFilesystemRequest =
          request.body.layerParameters.exists { params =>
            tryo(new URI(params.remoteUri.takeWhile(_ != '|')).getScheme).toOption.contains(PathSchemes.schemeFile)
          }
        for {
          dataSourceBox: Box[UsableDataSource] <- exploreRemoteLayerService
            .exploreRemoteDatasource(request.body.layerParameters, reportMutable)
            .shiftBox
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
              reportMutable += s"Error when exploring as layer set: ${formatFailureChain(f, includeStackTraces = true)}"
              None
            case Empty =>
              reportMutable += "Error when exploring as layer set: Empty"
              None
          }
        } yield Ok(Json.toJson(ExploreRemoteDatasetResponse(dataSourceOpt, reportMutable.mkString("\n"))))
      }
    }

  def validatePaths(): Action[List[UPath]] =
    Action.fox(validateJson[List[UPath]]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
        for {
          _ <- Fox.successful(())
          pathsAllowed = request.body.map(dataVaultService.pathIsAllowedToAddDirectly)
          result = request.body.zip(pathsAllowed).map { case (path, isAllowed) =>
            PathValidationResult(path, isAllowed)
          }
        } yield Ok(Json.toJson(result))
      }
    }

  def invalidateCache(datasetId: ObjectId): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.writeDataset(datasetId)) {
      datasetCache.invalidateCache(datasetId)
      for {
        dataSourceBox <- datasetCache.getById(datasetId).shiftBox
        _ = dataSourceBox.foreach(clearCachesOfDataSource(datasetId, _, layerName = None))
      } yield Ok
    }
  }

  def writeMirrors(failOnError: Boolean): Action[Seq[ObjectId]] = Action.fox(validateJson[Seq[ObjectId]]) {
    implicit request =>
      if (dataStoreConfig.Datastore.writeVirtualDatasetsMirror) {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
          if (failOnError) {
            for {
              results <- Fox.serialCombined(request.body)(writeMirrorForDataset)
              _ = logger.info(s"Successfully wrote dataset mirrors where needed for ${request.body.length} datasets.")
            } yield Ok(Json.toJson(results.flatten))
          } else {
            for {
              resultBoxes <- Fox.fromFuture(Fox.serialSequence(request.body)(writeMirrorForDataset))
              failures = resultBoxes.filter(_.isEmpty)
              failuresFormatted = failures.map(_.toString).mkString(", ")
              _ = logger.info(
                s"Wrote dataset mirrors where needed for ${request.body.length} datasets (${failures.length} failures: $failuresFormatted)"
              )
              results = resultBoxes.flatMap(_.toOption.flatten)
            } yield Ok(Json.toJson(results))
          }
        }
      } else Fox.successful(Ok(Json.toJson(Seq.empty[(ObjectId, String)])))
  }

  private def writeMirrorForDataset(datasetId: ObjectId): Fox[Option[(ObjectId, String)]] = {
    datasetCache.invalidateCache(datasetId)
    for {
      dataSourceBox <- datasetCache.getById(datasetId).shiftBox
      mirrorPathOpt <- Fox.runOptional(dataSourceBox.toOption) { dataSource =>
        dataSourceMirrorService.writeMirror(dataSource, datasetId) ?~> s"Error writing datasource mirror for $datasetId"
      }
    } yield mirrorPathOpt.flatten.map((datasetId, _))
  }

  private def refreshDataSource(datasetId: ObjectId)(using tc: TokenContext): Fox[DataSource] =
    for {
      dataSourceFromDB <- dsRemoteWebknossosClient.getDataSource(datasetId) ~> NOT_FOUND
      dataSourceId = dataSourceFromDB.id
      rootPathBox <- dsRemoteWebknossosClient.getLocalRootPathOrEmpty(datasetId).shiftBox
      dataSourceFromDirOpt <- rootPathBox match {
        case Full(rootPath) if Files.exists(rootPath) =>
          Fox.successful(
            Some(
              dataSourceService.dataSourceFromDir(
                rootPath,
                dataSourceId.organizationId,
                resolvePaths = true
              )
            )
          )
        case f: Failure => f.toFox
        case _          => Fox.successful(None)
      }
      _ <- Fox.runOptional(dataSourceFromDirOpt)(ds => dsRemoteWebknossosClient.updateDataSource(ds, datasetId))
      _ = datasetCache.invalidateCache(datasetId)
      newUsableFromDBBox <- datasetCache.getById(datasetId).shiftBox
      dataSourceToReturn <- (newUsableFromDBBox, dataSourceFromDirOpt) match {
        case (Full(newUsableFromDB), _)   => Fox.successful(newUsableFromDB)
        case (_, Some(dataSourceFromDir)) => Fox.successful(dataSourceFromDir)
        case _                            => Fox.failure("DataSource not found") ~> NOT_FOUND
      }
    } yield dataSourceToReturn

  def getOrganizationBaseDirectory(
      organizationId: String,
      requireAllowsUpload: Boolean,
      requireLocal: Boolean
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.webknossos) {
      for {
        baseDirectory <- baseDirService
          .getOneForOrga(
            organizationId,
            requireAllowsUpload = requireAllowsUpload,
            requireLocal = requireLocal
          )
          .toFox
      } yield Ok(Json.toJson(baseDirectory))
    }
  }

}
