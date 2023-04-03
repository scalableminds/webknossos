package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.google.inject.Inject
import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.SegmentToAgglomerateProto.SegmentToAgglomerateProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, Tree}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models._
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.services.{
  BinaryDataService,
  IsosurfaceRequest,
  IsosurfaceService,
  IsosurfaceServiceHolder
}
import com.scalableminds.webknossos.tracingstore.tracings.{
  KeyValueStoreImplicits,
  TracingDataStore,
  VersionedKeyValuePair
}
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebKnossosClient}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import org.jgrapht.alg.flow.PushRelabelMFImpl
import org.jgrapht.graph.{DefaultWeightedEdge, SimpleWeightedGraph}
import play.api.libs.json.{JsObject, JsValue, Json, OFormat}

import java.nio.file.Paths
import java.util
import java.util.UUID
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.jdk.CollectionConverters.asScalaSetConverter

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
    val isosurfaceServiceHolder: IsosurfaceServiceHolder,
    val remoteDatastoreClient: TSRemoteDatastoreClient,
    val remoteWebKnossosClient: TSRemoteWebKnossosClient
)(implicit ec: ExecutionContext)
    extends KeyValueStoreImplicits
    with FallbackDataHelper
    with FoxImplicits
    with LazyLogging
    with ProtoGeometryImplicits {

  val defaultSegmentToAgglomerateChunkSize: Int = 16 * 1024 // 256 KiB chunks (2 8-byte numbers per element)

  private def generateId: String = UUID.randomUUID.toString

  val binaryDataService = new BinaryDataService(Paths.get(""), 100, None, None, None)
  isosurfaceServiceHolder.tracingStoreIsosurfaceConfig = (binaryDataService, 30 seconds, 1)
  val isosurfaceService: IsosurfaceService = isosurfaceServiceHolder.tracingStoreIsosurfaceService

  private lazy val materializedInfoCache: AlfuFoxCache[(String, Long), EditableMappingInfo] = AlfuFoxCache(
    maxEntries = 100)

  private lazy val segmentToAgglomerateChunkCache: AlfuFoxCache[(String, Long, Long), Seq[(Long, Long)]] =
    AlfuFoxCache(maxEntries = 1000)

  def currentVersion(editableMappingId: String): Fox[Long] =
    tracingDataStore.editableMappingsInfo.getVersion(editableMappingId,
                                                     mayBeEmpty = Some(true),
                                                     emptyFallback = Some(0L))

  def infoJson(tracingId: String,
               editableMapping: EditableMappingInfo,
               editableMappingId: String,
               version: Option[Long]): Fox[JsObject] =
    for {
      version <- getClosestMaterializableVersionOrZero(editableMappingId, version)
    } yield
      Json.obj(
        "mappingName" -> editableMappingId,
        "version" -> version,
        "tracingId" -> tracingId,
        "baseMappingName" -> editableMapping.baseMappingName,
        "largestAgglomerateId" -> editableMapping.largestAgglomerateId,
        "createdTimestamp" -> editableMapping.createdTimestamp
      )

  def create(baseMappingName: String): Fox[(String, EditableMappingInfo)] = {
    val newId = generateId
    val newEditableMapping = EditableMappingInfo(
      baseMappingName = baseMappingName,
      createdTimestamp = System.currentTimeMillis(),
      largestAgglomerateId = 0L
    )
    for {
      _ <- tracingDataStore.editableMappingsInfo.put(newId, 0L, toProtoBytes(newEditableMapping))
    } yield (newId, newEditableMapping)
  }

  def exists(editableMappingId: String): Fox[Boolean] =
    for {
      versionOrMinusOne: Long <- tracingDataStore.editableMappingsInfo.getVersion(editableMappingId,
                                                                                  mayBeEmpty = Some(true),
                                                                                  version = Some(0L),
                                                                                  emptyFallback = Some(-1L))
    } yield versionOrMinusOne >= 0

  def duplicate(editableMappingIdOpt: Option[String],
                version: Option[Long],
                remoteFallbackLayer: RemoteFallbackLayer,
                userToken: Option[String]): Fox[String] =
    for {
      editableMappingId <- editableMappingIdOpt ?~> "duplicate on editable mapping without id"
      editableMapping <- getInfo(editableMappingId, version, remoteFallbackLayer, userToken)
      newId = generateId
      _ <- tracingDataStore.editableMappingsInfo.put(newId, 0L, toProtoBytes(editableMapping))
      _ <- duplicateSegmentToAgglomerate(editableMappingId, newId)
      _ <- duplicateAgglomerateToGraph(editableMappingId, newId)
    } yield newId

  private def duplicateSegmentToAgglomerate(editableMappingId: String, newId: String): Fox[Unit] = {
    val iterator = new VersionedIterator(editableMappingId, tracingDataStore.editableMappingsSegmentToAgglomerate, None)
    for {
      _ <- Fox.combined(iterator.map { keyValuePair =>
        for {
          chunkId <- chunkIdFromSegmentToAgglomerateKey(keyValuePair.key).toFox
          newKey = segmentToAgglomerateKey(newId, chunkId)
          _ <- tracingDataStore.editableMappingsSegmentToAgglomerate.put(newKey, version = 0L, keyValuePair.value)
        } yield ()
      }.toList)
    } yield ()
  }

  private def duplicateAgglomerateToGraph(editableMappingId: String, newId: String): Fox[Unit] = {
    val iterator = new VersionedIterator(editableMappingId, tracingDataStore.editableMappingsAgglomerateToGraph, None)
    for {
      _ <- Fox.combined(iterator.map { keyValuePair =>
        for {
          agglomerateId <- agglomerateIdFromAgglomerateGraphKey(keyValuePair.key).toFox
          newKey = agglomerateGraphKey(newId, agglomerateId)
          _ <- tracingDataStore.editableMappingsAgglomerateToGraph.put(newKey, version = 0L, keyValuePair.value)
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
      _ <- Fox.successful(logger.info("cache miss, applyPendingUpdates"))
      closestMaterializedWithVersion <- getClosestMaterialized(editableMappingId, desiredVersion)
      updatedEditableMappingInfo: EditableMappingInfo <- if (desiredVersion == closestMaterializedWithVersion.version)
        Fox.successful(closestMaterializedWithVersion.value)
      else
        for {
          pendingUpdates <- getPendingUpdates(editableMappingId, closestMaterializedWithVersion.version, desiredVersion)
          updater = new EditableMappingUpdater(editableMappingId,
                                               closestMaterializedWithVersion.version,
                                               desiredVersion,
                                               remoteFallbackLayer,
                                               userToken,
                                               remoteDatastoreClient,
                                               this,
                                               tracingDataStore)
          _ = logger.info(s"Applying ${pendingUpdates.length} updates, saving as v$desiredVersion")
          updated <- updater.applyUpdates(closestMaterializedWithVersion.value, pendingUpdates)
        } yield updated
    } yield updatedEditableMappingInfo

  private def getClosestMaterialized(editableMappingId: String,
                                     desiredVersion: Long): Fox[VersionedKeyValuePair[EditableMappingInfo]] =
    tracingDataStore.editableMappingsInfo.get(editableMappingId, version = Some(desiredVersion))(
      fromProtoBytes[EditableMappingInfo])

  private def getClosestMaterializableVersionOrZero(editableMappingId: String,
                                                    desiredVersion: Option[Long]): Fox[Long] =
    for {
      closestVersion <- tracingDataStore.editableMappingUpdates.getVersion(editableMappingId,
                                                                           version = desiredVersion,
                                                                           mayBeEmpty = Some(true),
                                                                           emptyFallback = Some(0L))
    } yield closestVersion

  private def getPendingUpdates(editableMappignId: String,
                                closestMaterializedVersion: Long,
                                closestMaterializableVersion: Long): Fox[List[EditableMappingUpdateAction]] =
    if (closestMaterializableVersion == closestMaterializedVersion) {
      Fox.successful(List.empty)
    } else {
      for {
        updates <- tracingDataStore.editableMappingUpdates.getMultipleVersions[List[EditableMappingUpdateAction]](
          editableMappignId,
          newestVersion = Some(closestMaterializableVersion),
          oldestVersion = Some(closestMaterializedVersion + 1L))(fromJsonBytes[List[EditableMappingUpdateAction]])
      } yield updates.reverse.flatten
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

  private def getSegmentToAgglomerateForSegments(segmentIds: Set[Long],
                                                 editableMappingId: String,
                                                 version: Long): Fox[Map[Long, Long]] = {
    val chunkIds = segmentIds.map(_ / defaultSegmentToAgglomerateChunkSize)
    for { // TODO: optimization: fossil-multiget. also: caching
      maps: List[Seq[(Long, Long)]] <- Fox.serialCombined(chunkIds.toList)(chunkId =>
        getSegmentToAgglomerateChunkFiltered(editableMappingId, chunkId, version, segmentIds))
    } yield maps.flatten.toMap
  }

  private def getSegmentToAgglomerateChunkFiltered(editableMappingId: String,
                                                   chunkId: Long,
                                                   version: Long,
                                                   segmentIds: Set[Long]): Fox[Seq[(Long, Long)]] =
    for {
      segmentToAgglomerateChunk <- segmentToAgglomerateChunkCache.getOrLoad(
        (editableMappingId, chunkId, version),
        _ => getSegmentToAgglomerateChunkWithEmptyFallback(editableMappingId, chunkId, Some(version)))
      filtered = segmentToAgglomerateChunk.filter(pair => segmentIds.contains(pair._1))
    } yield filtered

  def getSegmentToAgglomerateChunkWithEmptyFallback(editableMappingId: String,
                                                    chunkId: Long,
                                                    version: Option[Long]): Fox[Seq[(Long, Long)]] =
    for {
      chunkBox: Box[Seq[(Long, Long)]] <- getSegmentToAgglomerateChunk(editableMappingId, chunkId, version).futureBox
      segmentToAgglomerate <- chunkBox match {
        case Full(chunk) => Fox.successful(chunk)
        case Empty       => Fox.successful(Seq.empty[(Long, Long)])
        case f: Failure  => f.toFox
      }
    } yield segmentToAgglomerate

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

  def generateCombinedMappingSubset(segmentIds: Set[Long],
                                    editableMapping: EditableMappingInfo,
                                    editableMappingVersion: Long,
                                    editableMappingId: String,
                                    remoteFallbackLayer: RemoteFallbackLayer,
                                    userToken: Option[String]): Fox[Map[Long, Long]] =
    for {
      editableMappingSubset <- getSegmentToAgglomerateForSegments(segmentIds, editableMappingId, editableMappingVersion)
      segmentIdsInEditableMapping: Set[Long] = editableMappingSubset.keySet
      segmentIdsInBaseMapping: Set[Long] = segmentIds.diff(segmentIdsInEditableMapping)
      baseMappingSubset <- getBaseSegmentToAgglomeate(editableMapping.baseMappingName,
                                                      segmentIdsInBaseMapping,
                                                      remoteFallbackLayer,
                                                      userToken)
    } yield editableMappingSubset ++ baseMappingSubset

  def getAgglomerateSkeletonWithFallback(editableMappingId: String,
                                         remoteFallbackLayer: RemoteFallbackLayer,
                                         agglomerateId: Long,
                                         userToken: Option[String]): Fox[Array[Byte]] =
    for {
      editableMapping <- getInfo(editableMappingId, version = None, remoteFallbackLayer, userToken)
      agglomerateGraphBox <- getAgglomerateGraphForId(editableMappingId, agglomerateId, remoteFallbackLayer, userToken).futureBox
      skeletonBytes <- agglomerateGraphBox match {
        case Full(agglomerateGraph) =>
          Fox.successful(
            agglomerateGraphToSkeleton(editableMappingId, agglomerateGraph, remoteFallbackLayer, agglomerateId))
        case Empty =>
          remoteDatastoreClient.getAgglomerateSkeleton(userToken,
                                                       remoteFallbackLayer,
                                                       editableMapping.baseMappingName,
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
        name = s"agglomerate $agglomerateId ($editableMappingId)"
      ))

    val skeleton = SkeletonTracingDefaults.createInstance.copy(
      dataSetName = remoteFallbackLayer.dataSetName,
      trees = trees
    )
    skeleton.toByteArray
  }

  private def getBaseSegmentToAgglomeate(mappingName: String,
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
              elementClass: ElementClass): Fox[Array[Byte]] = {
    val mappedDataLongs = unmappedData.map(element => relevantMapping(element.toPositiveLong))
    for {
      bytes <- longsToBytes(mappedDataLongs, elementClass)
    } yield bytes
  }

  private def bytesToLongs(bytes: Array[Byte], elementClass: ElementClass): Fox[Array[Long]] =
    for {
      _ <- bool2Fox(!elementClass.isuint64)
      unsignedIntArray <- tryo(UnsignedIntegerArray.fromByteArray(bytes, elementClass)).toFox
    } yield unsignedIntArray.map(_.toPositiveLong)

  def bytesToUnsignedInt(bytes: Array[Byte], elementClass: ElementClass): Fox[Array[UnsignedInteger]] =
    for {
      _ <- bool2Fox(!elementClass.isuint64)
      unsignedIntArray <- tryo(UnsignedIntegerArray.fromByteArray(bytes, elementClass)).toFox
    } yield unsignedIntArray

  private def longsToBytes(longs: Array[Long], elementClass: ElementClass): Fox[Array[Byte]] =
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

  def createIsosurface(tracing: VolumeTracing,
                       tracingId: String,
                       request: WebKnossosIsosurfaceRequest,
                       userToken: Option[String]): Fox[(Array[Float], List[Int])] =
    for {
      mappingName <- tracing.mappingName.toFox
      segmentationLayer = editableMappingLayer(mappingName, tracing, tracingId, userToken)
      isosurfaceRequest = IsosurfaceRequest(
        dataSource = None,
        dataLayer = segmentationLayer,
        cuboid = request.cuboid(segmentationLayer),
        segmentId = request.segmentId,
        subsamplingStrides = request.subsamplingStrides,
        scale = request.scale,
        mapping = None,
        mappingType = None
      )
      result <- isosurfaceService.requestIsosurfaceViaActor(isosurfaceRequest)
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
                               version: Option[Long] = None): Fox[AgglomerateGraph] =
    for {
      _ <- getInfo(mappingId, version = version, remoteFallbackLayer, userToken)
      keyValuePair: VersionedKeyValuePair[AgglomerateGraph] <- tracingDataStore.editableMappingsAgglomerateToGraph.get(
        agglomerateGraphKey(mappingId, agglomerateId),
        version,
        mayBeEmpty = Some(true))(fromProtoBytes[AgglomerateGraph])
    } yield keyValuePair.value

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
      val minCutEdges: util.Set[DefaultWeightedEdge] = minCutImpl.getCutEdges
      minCutEdges.asScala.toList.map(e => (g.getEdgeSource(e), g.getEdgeTarget(e)))
    }
  }

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

}
