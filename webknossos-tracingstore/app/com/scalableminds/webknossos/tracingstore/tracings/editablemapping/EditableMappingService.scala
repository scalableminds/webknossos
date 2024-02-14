package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.google.inject.Inject
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.SegmentToAgglomerateProto.SegmentToAgglomerateProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, Tree, TreeTypeProto}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models._
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.services.{
  BinaryDataService,
  AdHocMeshRequest,
  AdHocMeshService,
  AdHocMeshingServiceHolder
}
import com.scalableminds.webknossos.tracingstore.tracings.{
  KeyValueStoreImplicits,
  TracingDataStore,
  VersionedKeyValuePair
}
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebKnossosClient}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.common.Box.tryo
import org.jgrapht.alg.flow.PushRelabelMFImpl
import org.jgrapht.graph.{DefaultWeightedEdge, SimpleWeightedGraph}
import play.api.libs.json.{JsObject, JsValue, Json, OFormat}

import java.nio.file.Paths
import java.util
import java.util.UUID
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.jdk.CollectionConverters.CollectionHasAsScala

case class FallbackDataKey(
    remoteFallbackLayer: RemoteFallbackLayer,
    dataRequests: List[WebKnossosDataRequest],
    userToken: Option[String]
)

case class MinCutParameters(
    segmentPosition1: Vec3Int,
    segmentPosition2: Vec3Int,
    mag: Vec3Int,
    agglomerateId: Long,
    editableMappingId: String
)

object MinCutParameters {
  implicit val jsonFormat: OFormat[MinCutParameters] = Json.format[MinCutParameters]
}

case class EdgeWithPositions(
    segmentId1: Long,
    segmentId2: Long,
    position1: Vec3Int,
    position2: Vec3Int
)

object EdgeWithPositions {
  implicit val jsonFormat: OFormat[EdgeWithPositions] = Json.format[EdgeWithPositions]
}

class EditableMappingService @Inject()(
    val tracingDataStore: TracingDataStore,
    val adHocMeshingServiceHolder: AdHocMeshingServiceHolder,
    val remoteDatastoreClient: TSRemoteDatastoreClient,
    val remoteWebKnossosClient: TSRemoteWebKnossosClient
)(implicit ec: ExecutionContext)
    extends KeyValueStoreImplicits
    with FallbackDataHelper
    with FoxImplicits
    with LazyLogging
    with ProtoGeometryImplicits {

  val defaultSegmentToAgglomerateChunkSize: Int = 64 * 1024 // max. 1 MiB chunks (two 8-byte numbers per element)

  private def generateId: String = UUID.randomUUID.toString

  val binaryDataService = new BinaryDataService(Paths.get(""), 100, None, None, None, None, None)
  adHocMeshingServiceHolder.tracingStoreAdHocMeshingConfig = (binaryDataService, 30 seconds, 1)
  private val adHocMeshingService: AdHocMeshService = adHocMeshingServiceHolder.tracingStoreAdHocMeshingService

  private lazy val materializedInfoCache: AlfuCache[(String, Long), EditableMappingInfo] = AlfuCache(maxCapacity = 100)

  private lazy val segmentToAgglomerateChunkCache: AlfuCache[(String, Long, Long), Seq[(Long, Long)]] =
    AlfuCache()

  private lazy val agglomerateToGraphCache: AlfuCache[(String, Long, Long), AgglomerateGraph] =
    AlfuCache(maxCapacity = 50)

  def infoJson(tracingId: String,
               editableMappingInfo: EditableMappingInfo,
               editableMappingId: String,
               version: Option[Long]): Fox[JsObject] =
    for {
      version <- getClosestMaterializableVersionOrZero(editableMappingId, version)
    } yield
      Json.obj(
        "mappingName" -> editableMappingId,
        "version" -> version,
        "tracingId" -> tracingId,
        "baseMappingName" -> editableMappingInfo.baseMappingName,
        "largestAgglomerateId" -> editableMappingInfo.largestAgglomerateId,
        "createdTimestamp" -> editableMappingInfo.createdTimestamp
      )

  def create(baseMappingName: String): Fox[(String, EditableMappingInfo)] = {
    val newId = generateId
    val newEditableMappingInfo = EditableMappingInfo(
      baseMappingName = baseMappingName,
      createdTimestamp = Instant.now.epochMillis,
      largestAgglomerateId = 0L
    )
    for {
      _ <- tracingDataStore.editableMappingsInfo.put(newId, 0L, toProtoBytes(newEditableMappingInfo))
    } yield (newId, newEditableMappingInfo)
  }

  def duplicate(editableMappingIdOpt: Option[String],
                version: Option[Long],
                remoteFallbackLayerBox: Box[RemoteFallbackLayer],
                userToken: Option[String]): Fox[String] =
    for {
      editableMappingId <- editableMappingIdOpt ?~> "duplicate on editable mapping without id"
      remoteFallbackLayer <- remoteFallbackLayerBox ?~> "duplicate on editable mapping without remote fallback layer"
      editableMappingInfoAndVersion <- getInfoAndActualVersion(editableMappingId,
                                                               version,
                                                               remoteFallbackLayer,
                                                               userToken)
      newIdAndInfoV0 <- create(editableMappingInfoAndVersion._1.baseMappingName)
      newId = newIdAndInfoV0._1
      newVersion = editableMappingInfoAndVersion._2
      _ <- tracingDataStore.editableMappingsInfo.put(newId, newVersion, toProtoBytes(editableMappingInfoAndVersion._1))
      _ <- duplicateSegmentToAgglomerate(editableMappingId, newId, newVersion)
      _ <- duplicateAgglomerateToGraph(editableMappingId, newId, newVersion)
      updateActionsWithVersions <- getUpdateActionsWithVersions(editableMappingId, editableMappingInfoAndVersion._2, 0L)
      _ <- Fox.serialCombined(updateActionsWithVersions) {
        updateActionsWithVersion: (Long, List[EditableMappingUpdateAction]) =>
          tracingDataStore.editableMappingUpdates.put(newId, updateActionsWithVersion._1, updateActionsWithVersion._2)
      }
    } yield newId

  private def duplicateSegmentToAgglomerate(editableMappingId: String, newId: String, newVersion: Long): Fox[Unit] = {
    val iterator =
      new VersionedFossilDbIterator(editableMappingId,
                                    tracingDataStore.editableMappingsSegmentToAgglomerate,
                                    Some(newVersion))
    for {
      _ <- Fox.combined(iterator.map { keyValuePair =>
        for {
          chunkId <- chunkIdFromSegmentToAgglomerateKey(keyValuePair.key).toFox
          newKey = segmentToAgglomerateKey(newId, chunkId)
          _ <- tracingDataStore.editableMappingsSegmentToAgglomerate.put(newKey,
                                                                         version = newVersion,
                                                                         keyValuePair.value)
        } yield ()
      }.toList)
    } yield ()
  }

  private def duplicateAgglomerateToGraph(editableMappingId: String, newId: String, newVersion: Long): Fox[Unit] = {
    val iterator =
      new VersionedFossilDbIterator(editableMappingId,
                                    tracingDataStore.editableMappingsAgglomerateToGraph,
                                    Some(newVersion))
    for {
      _ <- Fox.combined(iterator.map { keyValuePair =>
        for {
          agglomerateId <- agglomerateIdFromAgglomerateGraphKey(keyValuePair.key).toFox
          newKey = agglomerateGraphKey(newId, agglomerateId)
          _ <- tracingDataStore.editableMappingsAgglomerateToGraph.put(newKey, version = newVersion, keyValuePair.value)
        } yield ()
      }.toList)
    } yield ()
  }

  def updateActionLog(editableMappingId: String): Fox[JsValue] = {
    def versionedTupleToJson(tuple: (Long, List[EditableMappingUpdateAction])): JsObject =
      Json.obj(
        "version" -> tuple._1,
        "value" -> Json.toJson(tuple._2)
      )

    for {
      updates <- tracingDataStore.editableMappingUpdates.getMultipleVersionsAsVersionValueTuple(editableMappingId)(
        fromJsonBytes[List[EditableMappingUpdateAction]])
      updateActionGroupsJs = updates.map(versionedTupleToJson)
    } yield Json.toJson(updateActionGroupsJs)
  }

  def getInfo(editableMappingId: String,
              version: Option[Long] = None,
              remoteFallbackLayer: RemoteFallbackLayer,
              userToken: Option[String]): Fox[EditableMappingInfo] =
    for {
      (info, _) <- getInfoAndActualVersion(editableMappingId, version, remoteFallbackLayer, userToken)
    } yield info

  def getInfoAndActualVersion(editableMappingId: String,
                              requestedVersion: Option[Long] = None,
                              remoteFallbackLayer: RemoteFallbackLayer,
                              userToken: Option[String]): Fox[(EditableMappingInfo, Long)] =
    for {
      desiredVersion <- getClosestMaterializableVersionOrZero(editableMappingId, requestedVersion)
      materializedInfo <- materializedInfoCache.getOrLoad(
        (editableMappingId, desiredVersion),
        _ => applyPendingUpdates(editableMappingId, desiredVersion, remoteFallbackLayer, userToken))
    } yield (materializedInfo, desiredVersion)

  def update(editableMappingId: String,
             updateActionGroup: EditableMappingUpdateActionGroup,
             newVersion: Long): Fox[Unit] =
    for {
      actionsWithTimestamp <- Fox.successful(updateActionGroup.actions.map(_.addTimestamp(updateActionGroup.timestamp)))
      _ <- tracingDataStore.editableMappingUpdates.put(editableMappingId, newVersion, actionsWithTimestamp)
    } yield ()

  def applyPendingUpdates(editableMappingId: String,
                          desiredVersion: Long,
                          remoteFallbackLayer: RemoteFallbackLayer,
                          userToken: Option[String]): Fox[EditableMappingInfo] =
    for {
      closestMaterializedWithVersion <- getClosestMaterialized(editableMappingId, desiredVersion)
      updatedEditableMappingInfo: EditableMappingInfo <- if (desiredVersion == closestMaterializedWithVersion.version)
        Fox.successful(closestMaterializedWithVersion.value)
      else
        for {
          pendingUpdates <- getPendingUpdates(editableMappingId, closestMaterializedWithVersion.version, desiredVersion)
          updater = new EditableMappingUpdater(
            editableMappingId,
            closestMaterializedWithVersion.value.baseMappingName,
            closestMaterializedWithVersion.version,
            desiredVersion,
            remoteFallbackLayer,
            userToken,
            remoteDatastoreClient,
            this,
            tracingDataStore,
            relyOnAgglomerateIds = true
          )

          updated <- updater.applyUpdatesAndSave(closestMaterializedWithVersion.value, pendingUpdates)
        } yield updated
    } yield updatedEditableMappingInfo

  private def getClosestMaterialized(editableMappingId: String,
                                     desiredVersion: Long): Fox[VersionedKeyValuePair[EditableMappingInfo]] =
    tracingDataStore.editableMappingsInfo.get(editableMappingId, version = Some(desiredVersion))(
      fromProtoBytes[EditableMappingInfo])

  def getClosestMaterializableVersionOrZero(editableMappingId: String, desiredVersion: Option[Long]): Fox[Long] =
    tracingDataStore.editableMappingUpdates.getVersion(editableMappingId,
                                                       version = desiredVersion,
                                                       mayBeEmpty = Some(true),
                                                       emptyFallback = Some(0L))

  private def getPendingUpdates(editableMappingId: String,
                                closestMaterializedVersion: Long,
                                closestMaterializableVersion: Long): Fox[List[EditableMappingUpdateAction]] =
    if (closestMaterializableVersion == closestMaterializedVersion) {
      Fox.successful(List.empty)
    } else {
      for {
        updates <- getUpdateActionsWithVersions(editableMappingId,
                                                newestVersion = closestMaterializableVersion,
                                                oldestVersion = closestMaterializedVersion + 1L)
      } yield updates.map(_._2).reverse.flatten
    }

  private def getUpdateActionsWithVersions(
      editableMappingId: String,
      newestVersion: Long,
      oldestVersion: Long): Fox[List[(Long, List[EditableMappingUpdateAction])]] = {
    val batchRanges = batchRangeInclusive(oldestVersion, newestVersion, batchSize = 100)
    for {
      updateActionBatches <- Fox.serialCombined(batchRanges.toList) { batchRange =>
        val batchFrom = batchRange._1
        val batchTo = batchRange._2
        for {
          res <- tracingDataStore.editableMappingUpdates
            .getMultipleVersionsAsVersionValueTuple[List[EditableMappingUpdateAction]](
              editableMappingId,
              Some(batchTo),
              Some(batchFrom)
            )(fromJsonBytes[List[EditableMappingUpdateAction]])
        } yield res
      }
      flat = updateActionBatches.flatten
    } yield flat
  }

  def findSegmentIdAtPosition(remoteFallbackLayer: RemoteFallbackLayer,
                              pos: Vec3Int,
                              mag: Vec3Int,
                              userToken: Option[String]): Fox[Long] =
    for {
      voxelAsBytes: Array[Byte] <- remoteDatastoreClient.getVoxelAtPosition(userToken, remoteFallbackLayer, pos, mag)
      voxelAsLongArray: Array[Long] <- bytesToLongs(voxelAsBytes, remoteFallbackLayer.elementClass)
      _ <- Fox.bool2Fox(voxelAsLongArray.length == 1) ?~> s"Expected one, got ${voxelAsLongArray.length} segment id values for voxel."
      voxelAsLong <- voxelAsLongArray.headOption
    } yield voxelAsLong

  def volumeData(tracing: VolumeTracing,
                 tracingId: String,
                 dataRequests: DataRequestCollection,
                 userToken: Option[String]): Fox[(Array[Byte], List[Int])] =
    for {
      editableMappingId <- tracing.mappingName.toFox
      dataLayer = editableMappingLayer(editableMappingId, tracing, tracingId, userToken)
      requests = dataRequests.map(r =>
        DataServiceDataRequest(null, dataLayer, None, r.cuboid(dataLayer), r.settings.copy(appliedAgglomerate = None)))
      data <- binaryDataService.handleDataRequests(requests)
    } yield data

  private def getSegmentToAgglomerateForSegmentIds(segmentIds: Set[Long],
                                                   editableMappingId: String,
                                                   version: Long): Fox[Map[Long, Long]] = {
    val chunkIds = segmentIds.map(_ / defaultSegmentToAgglomerateChunkSize)
    for {
      maps: List[Seq[(Long, Long)]] <- Fox.serialCombined(chunkIds.toList)(chunkId =>
        getSegmentToAgglomerateChunkFiltered(editableMappingId, chunkId, version, segmentIds))
    } yield maps.flatten.toMap
  }

  private def getSegmentToAgglomerateChunkFiltered(editableMappingId: String,
                                                   chunkId: Long,
                                                   version: Long,
                                                   segmentIds: Set[Long]): Fox[Seq[(Long, Long)]] =
    for {
      segmentToAgglomerateChunk <- getSegmentToAgglomerateChunkWithEmptyFallback(editableMappingId, chunkId, version)
      filtered = segmentToAgglomerateChunk.filter(pair => segmentIds.contains(pair._1))
    } yield filtered

  def getSegmentToAgglomerateChunkWithEmptyFallback(editableMappingId: String,
                                                    chunkId: Long,
                                                    version: Long): Fox[Seq[(Long, Long)]] =
    segmentToAgglomerateChunkCache.getOrLoad(
      (editableMappingId, chunkId, version),
      _ =>
        for {
          chunkBox: Box[Seq[(Long, Long)]] <- getSegmentToAgglomerateChunk(editableMappingId, chunkId, Some(version)).futureBox
          segmentToAgglomerate <- chunkBox match {
            case Full(chunk) => Fox.successful(chunk)
            case Empty       => Fox.successful(Seq.empty[(Long, Long)])
            case f: Failure  => f.toFox
          }
        } yield segmentToAgglomerate
    )

  private def getSegmentToAgglomerateChunk(editableMappingId: String,
                                           agglomerateId: Long,
                                           version: Option[Long]): Fox[Seq[(Long, Long)]] =
    for {
      keyValuePair: VersionedKeyValuePair[SegmentToAgglomerateProto] <- tracingDataStore.editableMappingsSegmentToAgglomerate
        .get(segmentToAgglomerateKey(editableMappingId, agglomerateId), version, mayBeEmpty = Some(true))(
          fromProtoBytes[SegmentToAgglomerateProto])
      valueProto = keyValuePair.value
      asSequence = valueProto.segmentToAgglomerate.map(pair => pair.segmentId -> pair.agglomerateId)
    } yield asSequence

  def generateCombinedMappingForSegmentIds(segmentIds: Set[Long],
                                           editableMapping: EditableMappingInfo,
                                           editableMappingVersion: Long,
                                           editableMappingId: String,
                                           remoteFallbackLayer: RemoteFallbackLayer,
                                           userToken: Option[String]): Fox[Map[Long, Long]] =
    for {
      editableMappingForSegmentIds <- getSegmentToAgglomerateForSegmentIds(segmentIds,
                                                                           editableMappingId,
                                                                           editableMappingVersion)
      segmentIdsInEditableMapping: Set[Long] = editableMappingForSegmentIds.keySet
      segmentIdsInBaseMapping: Set[Long] = segmentIds.diff(segmentIdsInEditableMapping)
      baseMappingSubset <- getBaseSegmentToAgglomerate(editableMapping.baseMappingName,
                                                       segmentIdsInBaseMapping,
                                                       remoteFallbackLayer,
                                                       userToken)
    } yield editableMappingForSegmentIds ++ baseMappingSubset

  def getAgglomerateSkeletonWithFallback(editableMappingId: String,
                                         remoteFallbackLayer: RemoteFallbackLayer,
                                         agglomerateId: Long,
                                         userToken: Option[String]): Fox[Array[Byte]] =
    for {
      // called here to ensure updates are applied
      editableMappingInfo <- getInfo(editableMappingId, version = None, remoteFallbackLayer, userToken)
      agglomerateGraphBox <- getAgglomerateGraphForId(editableMappingId, agglomerateId, remoteFallbackLayer, userToken).futureBox
      skeletonBytes <- agglomerateGraphBox match {
        case Full(agglomerateGraph) =>
          Fox.successful(
            agglomerateGraphToSkeleton(editableMappingId, agglomerateGraph, remoteFallbackLayer, agglomerateId))
        case Empty =>
          remoteDatastoreClient.getAgglomerateSkeleton(userToken,
                                                       remoteFallbackLayer,
                                                       editableMappingInfo.baseMappingName,
                                                       agglomerateId)
        case f: Failure => f.toFox
      }
    } yield skeletonBytes

  private def agglomerateGraphToSkeleton(editableMappingId: String,
                                         graph: AgglomerateGraph,
                                         remoteFallbackLayer: RemoteFallbackLayer,
                                         agglomerateId: Long): Array[Byte] = {
    val nodeIdStartAtOneOffset = 1
    val nodes = graph.positions.zipWithIndex.map {
      case (pos, idx) =>
        NodeDefaults.createInstance.copy(
          id = idx + nodeIdStartAtOneOffset,
          position = pos
        )
    }
    val segmentIdToNodeIdMinusOne: Map[Long, Int] = graph.segments.zipWithIndex.toMap
    val skeletonEdges = graph.edges.map { e =>
      Edge(source = segmentIdToNodeIdMinusOne(e.source) + nodeIdStartAtOneOffset,
           target = segmentIdToNodeIdMinusOne(e.target) + nodeIdStartAtOneOffset)
    }

    val trees = Seq(
      Tree(
        treeId = math.abs(agglomerateId.toInt), // used only to deterministically select tree color
        createdTimestamp = System.currentTimeMillis(),
        nodes = nodes,
        edges = skeletonEdges,
        name = s"agglomerate $agglomerateId ($editableMappingId)",
        `type` = Some(TreeTypeProto.AGGLOMERATE)
      ))

    val skeleton = SkeletonTracingDefaults.createInstance.copy(
      datasetName = remoteFallbackLayer.dataSetName,
      trees = trees
    )
    skeleton.toByteArray
  }

  def getBaseSegmentToAgglomerate(mappingName: String,
                                  segmentIds: Set[Long],
                                  remoteFallbackLayer: RemoteFallbackLayer,
                                  userToken: Option[String]): Fox[Map[Long, Long]] = {
    val segmentIdsOrdered = segmentIds.toList
    for {
      agglomerateIdsOrdered <- remoteDatastoreClient.getAgglomerateIdsForSegmentIds(remoteFallbackLayer,
                                                                                    mappingName,
                                                                                    segmentIdsOrdered,
                                                                                    userToken)
    } yield segmentIdsOrdered.zip(agglomerateIdsOrdered).toMap
  }

  def collectSegmentIds(data: Array[UnsignedInteger]): Set[Long] =
    data.toSet.map { u: UnsignedInteger =>
      u.toPositiveLong
    }

  def mapData(unmappedData: Array[UnsignedInteger],
              relevantMapping: Map[Long, Long],
              elementClass: ElementClassProto): Fox[Array[Byte]] = {
    val mappedDataLongs = unmappedData.map(element => relevantMapping(element.toPositiveLong))
    for {
      bytes <- longsToBytes(mappedDataLongs, elementClass)
    } yield bytes
  }

  private def bytesToLongs(bytes: Array[Byte], elementClass: ElementClassProto): Fox[Array[Long]] =
    for {
      _ <- bool2Fox(!elementClass.isuint64)
      unsignedIntArray <- tryo(UnsignedIntegerArray.fromByteArray(bytes, elementClass)).toFox
    } yield unsignedIntArray.map(_.toPositiveLong)

  def bytesToUnsignedInt(bytes: Array[Byte], elementClass: ElementClassProto): Fox[Array[UnsignedInteger]] =
    for {
      _ <- bool2Fox(!elementClass.isuint64)
      unsignedIntArray <- tryo(UnsignedIntegerArray.fromByteArray(bytes, elementClass)).toFox
    } yield unsignedIntArray

  private def longsToBytes(longs: Array[Long], elementClass: ElementClassProto): Fox[Array[Byte]] =
    for {
      _ <- bool2Fox(!elementClass.isuint64)
      unsignedIntArray: Array[UnsignedInteger] = longs.map(UnsignedInteger.fromLongWithElementClass(_, elementClass))
      bytes = UnsignedIntegerArray.toByteArray(unsignedIntArray, elementClass)
    } yield bytes

  private def editableMappingLayer(mappingName: String,
                                   tracing: VolumeTracing,
                                   tracingId: String,
                                   userToken: Option[String]): EditableMappingLayer =
    EditableMappingLayer(
      mappingName,
      tracing.boundingBox,
      resolutions = tracing.resolutions.map(vec3IntFromProto).toList,
      largestSegmentId = Some(0L),
      elementClass = tracing.elementClass,
      userToken,
      tracing = tracing,
      tracingId = tracingId,
      editableMappingService = this
    )

  def createAdHocMesh(tracing: VolumeTracing,
                      tracingId: String,
                      request: WebknossosAdHocMeshRequest,
                      userToken: Option[String]): Fox[(Array[Float], List[Int])] =
    for {
      mappingName <- tracing.mappingName.toFox
      segmentationLayer = editableMappingLayer(mappingName, tracing, tracingId, userToken)
      adHocMeshRequest = AdHocMeshRequest(
        dataSource = None,
        dataLayer = segmentationLayer,
        cuboid = request.cuboid(segmentationLayer),
        segmentId = request.segmentId,
        subsamplingStrides = request.subsamplingStrides,
        scale = request.scale,
        mapping = None,
        mappingType = None,
        findNeighbors = request.findNeighbors
      )
      result <- adHocMeshingService.requestAdHocMeshViaActor(adHocMeshRequest)
    } yield result

  def agglomerateGraphKey(mappingId: String, agglomerateId: Long): String =
    s"$mappingId/$agglomerateId"

  def segmentToAgglomerateKey(mappingId: String, chunkId: Long): String =
    s"$mappingId/$chunkId"

  private def chunkIdFromSegmentToAgglomerateKey(key: String): Box[Long] = tryo(key.split("/")(1).toLong)

  private def agglomerateIdFromAgglomerateGraphKey(key: String): Box[Long] = tryo(key.split("/")(1).toLong)

  def getAgglomerateGraphForId(mappingId: String,
                               agglomerateId: Long,
                               remoteFallbackLayer: RemoteFallbackLayer,
                               userToken: Option[String],
                               requestedVersion: Option[Long] = None): Fox[AgglomerateGraph] =
    for {
      // called here to ensure updates are applied
      (_, version) <- getInfoAndActualVersion(mappingId, requestedVersion, remoteFallbackLayer, userToken)
      agglomerateGraph <- agglomerateToGraphCache.getOrLoad(
        (mappingId, agglomerateId, version),
        _ =>
          tracingDataStore.editableMappingsAgglomerateToGraph
            .get(agglomerateGraphKey(mappingId, agglomerateId), Some(version), mayBeEmpty = Some(true))(
              fromProtoBytes[AgglomerateGraph])
            .map(_.value)
      )
    } yield agglomerateGraph

  def getAgglomerateGraphForIdWithFallback(mapping: EditableMappingInfo,
                                           editableMappingId: String,
                                           version: Option[Long],
                                           agglomerateId: Long,
                                           remoteFallbackLayer: RemoteFallbackLayer,
                                           userToken: Option[String]): Fox[AgglomerateGraph] =
    for {
      agglomerateGraphBox <- getAgglomerateGraphForId(editableMappingId,
                                                      agglomerateId,
                                                      remoteFallbackLayer,
                                                      userToken,
                                                      version).futureBox
      agglomerateGraph <- agglomerateGraphBox match {
        case Full(agglomerateGraph) => Fox.successful(agglomerateGraph)
        case Empty =>
          remoteDatastoreClient.getAgglomerateGraph(remoteFallbackLayer,
                                                    mapping.baseMappingName,
                                                    agglomerateId,
                                                    userToken)
        case f: Failure => f.toFox
      }
    } yield agglomerateGraph

  def agglomerateGraphMinCut(parameters: MinCutParameters,
                             remoteFallbackLayer: RemoteFallbackLayer,
                             userToken: Option[String]): Fox[List[EdgeWithPositions]] =
    for {
      segmentId1 <- findSegmentIdAtPosition(remoteFallbackLayer, parameters.segmentPosition1, parameters.mag, userToken)
      segmentId2 <- findSegmentIdAtPosition(remoteFallbackLayer, parameters.segmentPosition2, parameters.mag, userToken)
      // called here to ensure updates are applied
      mapping <- getInfo(parameters.editableMappingId, version = None, remoteFallbackLayer, userToken)
      agglomerateGraph <- getAgglomerateGraphForIdWithFallback(mapping,
                                                               parameters.editableMappingId,
                                                               None,
                                                               parameters.agglomerateId,
                                                               remoteFallbackLayer,
                                                               userToken)
      edgesToCut <- minCut(agglomerateGraph, segmentId1, segmentId2) ?~> "Could not calculate min-cut on agglomerate graph."
      edgesWithPositions = annotateEdgesWithPositions(edgesToCut, agglomerateGraph)
    } yield edgesWithPositions

  private def minCut(agglomerateGraph: AgglomerateGraph,
                     segmentId1: Long,
                     segmentId2: Long): Box[List[(Long, Long)]] = {
    val g = new SimpleWeightedGraph[Long, DefaultWeightedEdge](classOf[DefaultWeightedEdge])
    agglomerateGraph.segments.foreach { segmentId =>
      g.addVertex(segmentId)
    }
    agglomerateGraph.edges.zip(agglomerateGraph.affinities).foreach {
      case (edge, affinity) =>
        val e = g.addEdge(edge.source, edge.target)
        g.setEdgeWeight(e, affinity)
    }
    tryo {
      val minCutImpl = new PushRelabelMFImpl(g)
      minCutImpl.calculateMinCut(segmentId1, segmentId2)
      val sourcePartition: util.Set[Long] = minCutImpl.getSourcePartition
      val minCutEdges: util.Set[DefaultWeightedEdge] = minCutImpl.getCutEdges
      minCutEdges.asScala.toList.map(e =>
        setDirectionForCutting(g.getEdgeSource(e), g.getEdgeTarget(e), sourcePartition))
    }
  }

  // the returned edges must be directed so that when they are passed to the split action, the source segment keeps its agglomerate id
  private def setDirectionForCutting(node1: Long, node2: Long, sourcePartition: util.Set[Long]): (Long, Long) =
    if (sourcePartition.contains(node1)) (node1, node2) else (node2, node1)

  private def annotateEdgesWithPositions(edges: List[(Long, Long)],
                                         agglomerateGraph: AgglomerateGraph): List[EdgeWithPositions] =
    edges.map {
      case (segmentId1, segmentId2) =>
        val index1 = agglomerateGraph.segments.indexOf(segmentId1)
        val index2 = agglomerateGraph.segments.indexOf(segmentId2)
        val position1 = agglomerateGraph.positions(index1)
        val position2 = agglomerateGraph.positions(index2)
        EdgeWithPositions(
          segmentId1,
          segmentId2,
          position1,
          position2
        )
    }

  def merge(editableMappingIds: List[String],
            remoteFallbackLayer: RemoteFallbackLayer,
            userToken: Option[String]): Fox[String] =
    for {
      firstMappingId <- editableMappingIds.headOption.toFox
      before = Instant.now
      newMappingId <- duplicate(Some(firstMappingId), version = None, Some(remoteFallbackLayer), userToken)
      _ <- Fox.serialCombined(editableMappingIds.tail)(editableMappingId =>
        mergeInto(newMappingId, editableMappingId, remoteFallbackLayer, userToken))
      _ = logger.info(s"Merging ${editableMappingIds.length} editable mappings took ${Instant.since(before)}")
    } yield newMappingId

  // read as: merge source into target (mutate target)
  private def mergeInto(targetEditableMappingId: String,
                        sourceEditableMappingId: String,
                        remoteFallbackLayer: RemoteFallbackLayer,
                        userToken: Option[String]): Fox[Unit] =
    for {
      targetNewestVersion <- getClosestMaterializableVersionOrZero(targetEditableMappingId, None)
      sourceNewestMaterializedWithVersion <- getInfoAndActualVersion(sourceEditableMappingId,
                                                                     None,
                                                                     remoteFallbackLayer,
                                                                     userToken)
      sourceNewestVersion = sourceNewestMaterializedWithVersion._2
      updateActionsWithVersions <- getUpdateActionsWithVersions(sourceEditableMappingId, sourceNewestVersion, 0L)
      updateActionsToApply = updateActionsWithVersions.map(_._2).reverse.flatten
      updater = new EditableMappingUpdater(
        targetEditableMappingId,
        sourceNewestMaterializedWithVersion._1.baseMappingName,
        targetNewestVersion,
        targetNewestVersion + sourceNewestVersion,
        remoteFallbackLayer,
        userToken,
        remoteDatastoreClient,
        this,
        tracingDataStore,
        relyOnAgglomerateIds = false
      )
      _ <- updater.applyUpdatesAndSave(sourceNewestMaterializedWithVersion._1, updateActionsToApply)
      _ <- Fox.serialCombined(updateActionsWithVersions) { updateActionsWithVersion =>
        tracingDataStore.editableMappingUpdates.put(targetEditableMappingId,
                                                    updateActionsWithVersion._1 + targetNewestVersion,
                                                    updateActionsWithVersion._2)
      }
    } yield ()

  private def batchRangeInclusive(from: Long, to: Long, batchSize: Long): Seq[(Long, Long)] =
    (0L to ((to - from) / batchSize)).map { batchIndex =>
      val batchFrom = batchIndex * batchSize + from
      val batchTo = Math.min(to, (batchIndex + 1) * batchSize + from - 1)
      (batchFrom, batchTo)
    }
}
