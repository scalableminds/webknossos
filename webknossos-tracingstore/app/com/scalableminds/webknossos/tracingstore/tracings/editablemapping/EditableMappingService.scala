package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.SegmentToAgglomerateProto.SegmentToAgglomerateChunkProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, Tree, TreeTypeProto}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.helpers.{
  NativeBucketScanner,
  NodeDefaults,
  ProtoGeometryImplicits,
  SkeletonTracingDefaults
}
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models._
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.services.mesh.{AdHocMeshRequest, AdHocMeshService, AdHocMeshServiceHolder}
import com.scalableminds.webknossos.datastore.services.BinaryDataService
import com.scalableminds.webknossos.tracingstore.tracings.volume.{ReversionHelper, TSDatasetErrorLoggingService}
import com.scalableminds.webknossos.tracingstore.tracings.{
  FallbackDataHelper,
  FossilDBPutBuffer,
  KeyValueStoreImplicits,
  RemoteFallbackLayer,
  TracingDataStore,
  VersionedKeyValuePair
}
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebknossosClient}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.tracingstore.annotation.{UpdateAction, UpdateGroupHandling}
import org.jgrapht.alg.flow.PushRelabelMFImpl
import org.jgrapht.graph.{DefaultWeightedEdge, SimpleWeightedGraph}
import play.api.libs.json.{JsObject, Json, OFormat}

import java.nio.file.Path
import java.util
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.jdk.CollectionConverters.CollectionHasAsScala

case class FallbackDataKey(
    remoteFallbackLayer: RemoteFallbackLayer,
    dataRequest: WebknossosDataRequest,
    userToken: Option[String]
)

case class MinCutParameters(
    segmentId1: Long,
    segmentId2: Long,
    mag: Vec3Int,
    agglomerateId: Long
)

object MinCutParameters {
  implicit val jsonFormat: OFormat[MinCutParameters] = Json.format[MinCutParameters]
}

case class NeighborsParameters(segmentId: Long, mag: Vec3Int, agglomerateId: Long)

object NeighborsParameters {
  implicit val jsonFormat: OFormat[NeighborsParameters] = Json.format[NeighborsParameters]
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

case class NodeWithPosition(
    segmentId: Long,
    position: Vec3Int
)

object NodeWithPosition {
  implicit val jsonFormat: OFormat[NodeWithPosition] = Json.format[NodeWithPosition]
}

class EditableMappingService @Inject()(
    datasetErrorLoggingService: TSDatasetErrorLoggingService,
    val tracingDataStore: TracingDataStore,
    val adHocMeshServiceHolder: AdHocMeshServiceHolder,
    val remoteDatastoreClient: TSRemoteDatastoreClient,
    val remoteWebknossosClient: TSRemoteWebknossosClient
)(implicit ec: ExecutionContext)
    extends KeyValueStoreImplicits
    with FallbackDataHelper
    with FoxImplicits
    with ReversionHelper
    with EditableMappingElementKeys
    with LazyLogging
    with UpdateGroupHandling
    with ProtoGeometryImplicits {

  val defaultSegmentToAgglomerateChunkSize: Int = 64 * 1024 // max. 1 MiB chunks (two 8-byte numbers per element)

  private val binaryDataService = new BinaryDataService(Path.of(""), None, None, None, datasetErrorLoggingService)

  adHocMeshServiceHolder.tracingStoreAdHocMeshConfig = (binaryDataService, 30 seconds, 1)
  private val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.tracingStoreAdHocMeshService

  private lazy val segmentToAgglomerateChunkCache: AlfuCache[(String, Long, Long), Seq[(Long, Long)]] =
    AlfuCache()

  private lazy val agglomerateToGraphCache: AlfuCache[(String, Long, Long), AgglomerateGraph] =
    AlfuCache(maxCapacity = 50)

  private lazy val nativeBucketScanner: NativeBucketScanner = new NativeBucketScanner()

  def infoJson(tracingId: String, editableMappingInfo: EditableMappingInfo): JsObject =
    Json.obj(
      "tracingId" -> tracingId,
      "baseMappingName" -> editableMappingInfo.baseMappingName,
      "largestAgglomerateId" -> editableMappingInfo.largestAgglomerateId,
      "createdTimestamp" -> editableMappingInfo.createdTimestamp
    )

  def create(baseMappingName: String): EditableMappingInfo =
    EditableMappingInfo(
      baseMappingName = baseMappingName,
      createdTimestamp = Instant.now.epochMillis,
      largestAgglomerateId = 0L
    )

  def duplicateSegmentToAgglomerate(sourceTracingId: String,
                                    newId: String,
                                    sourceVersion: Long,
                                    newVersion: Long): Fox[Unit] = {
    val putBuffer =
      new FossilDBPutBuffer(tracingDataStore.editableMappingsSegmentToAgglomerate, version = Some(newVersion))
    val sourceIterator =
      new VersionedFossilDbIterator(sourceTracingId,
                                    tracingDataStore.editableMappingsSegmentToAgglomerate,
                                    Some(sourceVersion))
    for {
      _ <- Fox.serialCombined(sourceIterator) { keyValuePair =>
        for {
          chunkId <- chunkIdFromSegmentToAgglomerateKey(keyValuePair.key).toFox
          newKey = segmentToAgglomerateKey(newId, chunkId)
          _ <- putBuffer.put(newKey, keyValuePair.value)
        } yield ()
      }
      _ <- putBuffer.flush()
    } yield ()
  }

  def duplicateAgglomerateToGraph(sourceTracingId: String,
                                  newId: String,
                                  sourceVersion: Long,
                                  newVersion: Long): Fox[Unit] = {
    val putBuffer =
      new FossilDBPutBuffer(tracingDataStore.editableMappingsAgglomerateToGraph, version = Some(newVersion))
    val sourceIterator =
      new VersionedFossilDbIterator(sourceTracingId,
                                    tracingDataStore.editableMappingsAgglomerateToGraph,
                                    Some(sourceVersion))
    for {
      _ <- Fox.serialCombined(sourceIterator) { keyValuePair =>
        for {
          agglomerateId <- agglomerateIdFromAgglomerateGraphKey(keyValuePair.key).toFox
          newKey = agglomerateGraphKey(newId, agglomerateId)
          _ <- putBuffer.put(newKey, keyValuePair.value)
        } yield ()
      }
      _ <- putBuffer.flush()
    } yield ()
  }

  def assertTracingHasEditableMapping(tracing: VolumeTracing)(implicit ec: ExecutionContext): Fox[Unit] =
    Fox.fromBool(tracing.getHasEditableMapping) ?~> "annotation.volume.noEditableMapping"

  def findSegmentIdAtPositionIfNeeded(remoteFallbackLayer: RemoteFallbackLayer,
                                      positionOpt: Option[Vec3Int],
                                      segmentIdOpt: Option[Long],
                                      mag: Vec3Int)(implicit tc: TokenContext): Fox[Long] =
    segmentIdOpt match {
      case Some(segmentId) => Fox.successful(segmentId)
      case None            => findSegmentIdAtPosition(remoteFallbackLayer, positionOpt, mag)
    }

  private def findSegmentIdAtPosition(remoteFallbackLayer: RemoteFallbackLayer,
                                      positionOpt: Option[Vec3Int],
                                      mag: Vec3Int)(implicit tc: TokenContext): Fox[Long] =
    for {
      pos <- positionOpt.toFox ?~> "segment id or position is required in editable mapping action"
      voxelAsBytes: Array[Byte] <- remoteDatastoreClient.getVoxelAtPosition(remoteFallbackLayer, pos, mag)
      voxelAsLongArray: Array[Long] <- bytesToLongs(voxelAsBytes, remoteFallbackLayer.elementClass)
      _ <- Fox.fromBool(voxelAsLongArray.length == 1) ?~> s"Expected one, got ${voxelAsLongArray.length} segment id values for voxel."
      voxelAsLong <- voxelAsLongArray.headOption.toFox
    } yield voxelAsLong

  def volumeData(editableMappingLayer: EditableMappingLayer, dataRequests: DataRequestCollection)(
      implicit tc: TokenContext): Fox[(Array[Byte], List[Int])] = {
    val requests = dataRequests.map(
      r =>
        DataServiceDataRequest(None,
                               editableMappingLayer,
                               r.cuboid(editableMappingLayer),
                               r.settings.copy(appliedAgglomerate = None)))
    binaryDataService.handleDataRequests(requests)
  }

  def volumeDataBucketBoxes(editableMappingLayer: EditableMappingLayer, dataRequests: DataRequestCollection)(
      implicit tc: TokenContext): Fox[Seq[Box[Array[Byte]]]] = {
    val requests = dataRequests.map(
      r =>
        DataServiceDataRequest(None,
                               editableMappingLayer,
                               r.cuboid(editableMappingLayer),
                               r.settings.copy(appliedAgglomerate = None)))
    binaryDataService.handleMultipleBucketRequests(requests)
  }

  private def getSegmentToAgglomerateForSegmentIds(segmentIds: Set[Long],
                                                   tracingId: String,
                                                   version: Long): Fox[Map[Long, Long]] = {
    val chunkIds = segmentIds.map(_ / defaultSegmentToAgglomerateChunkSize)
    for {
      maps: List[Seq[(Long, Long)]] <- Fox.serialCombined(chunkIds.toList)(chunkId =>
        getSegmentToAgglomerateChunkFiltered(tracingId, chunkId, version, segmentIds))
    } yield maps.flatten.toMap
  }

  private def getSegmentToAgglomerateChunkFiltered(tracingId: String,
                                                   chunkId: Long,
                                                   version: Long,
                                                   segmentIds: Set[Long]): Fox[Seq[(Long, Long)]] =
    for {
      segmentToAgglomerateChunk <- getSegmentToAgglomerateChunkWithEmptyFallback(tracingId, chunkId, version)
      filtered = segmentToAgglomerateChunk.filter(pair => segmentIds.contains(pair._1))
    } yield filtered

  def getSegmentToAgglomerateChunkWithEmptyFallback(tracingId: String,
                                                    chunkId: Long,
                                                    version: Long): Fox[Seq[(Long, Long)]] =
    segmentToAgglomerateChunkCache.getOrLoad(
      (tracingId, chunkId, version),
      _ =>
        for {
          chunkBox: Box[Seq[(Long, Long)]] <- getSegmentToAgglomerateChunk(tracingId, chunkId, Some(version)).shiftBox
          segmentToAgglomerate <- chunkBox match {
            case Full(chunk) => Fox.successful(chunk)
            case Empty       => Fox.successful(Seq.empty[(Long, Long)])
            case f: Failure  => f.toFox
          }
        } yield segmentToAgglomerate
    )

  private def getSegmentToAgglomerateChunk(tracingId: String,
                                           chunkId: Long,
                                           version: Option[Long]): Fox[Seq[(Long, Long)]] = {
    val chunkKey = segmentToAgglomerateKey(tracingId, chunkId)
    getSegmentToAgglomerateChunk(chunkKey, version)
  }

  def getSegmentToAgglomerateChunk(chunkKey: String, version: Option[Long]): Fox[Seq[(Long, Long)]] =
    for {
      keyValuePairBytes: VersionedKeyValuePair[Array[Byte]] <- tracingDataStore.editableMappingsSegmentToAgglomerate
        .get(chunkKey, version, mayBeEmpty = Some(true))
      valueProto <- if (isRevertedElement(keyValuePairBytes.value)) Fox.empty
      else fromProtoBytes[SegmentToAgglomerateChunkProto](keyValuePairBytes.value).toFox
      asSequence = valueProto.segmentToAgglomerate.map(pair => pair.segmentId -> pair.agglomerateId)
    } yield asSequence

  def generateCombinedMappingForSegmentIds(
      segmentIds: Set[Long],
      editableMapping: EditableMappingInfo,
      editableMappingVersion: Long,
      tracingId: String,
      remoteFallbackLayer: RemoteFallbackLayer)(implicit tc: TokenContext): Fox[Map[Long, Long]] =
    for {
      editableMappingForSegmentIds <- getSegmentToAgglomerateForSegmentIds(segmentIds,
                                                                           tracingId,
                                                                           editableMappingVersion)
      segmentIdsInEditableMapping: Set[Long] = editableMappingForSegmentIds.keySet
      segmentIdsInBaseMapping: Set[Long] = segmentIds.diff(segmentIdsInEditableMapping)
      baseMappingSubset <- getBaseSegmentToAgglomerate(editableMapping.baseMappingName,
                                                       segmentIdsInBaseMapping,
                                                       remoteFallbackLayer)
    } yield editableMappingForSegmentIds ++ baseMappingSubset

  def getAgglomerateSkeletonWithFallback(tracingId: String,
                                         version: Long,
                                         editableMappingInfo: EditableMappingInfo,
                                         remoteFallbackLayer: RemoteFallbackLayer,
                                         agglomerateId: Long)(implicit tc: TokenContext): Fox[Array[Byte]] =
    for {
      agglomerateGraphBox <- getAgglomerateGraphForId(tracingId, version, agglomerateId).shiftBox
      skeletonBytes <- agglomerateGraphBox match {
        case Full(agglomerateGraph) =>
          Fox.successful(agglomerateGraphToSkeleton(tracingId, agglomerateGraph, agglomerateId))
        case Empty =>
          remoteDatastoreClient.getAgglomerateSkeleton(remoteFallbackLayer,
                                                       editableMappingInfo.baseMappingName,
                                                       agglomerateId)
        case f: Failure => f.toFox
      }
    } yield skeletonBytes

  private def agglomerateGraphToSkeleton(tracingId: String,
                                         graph: AgglomerateGraph,
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
        name = s"agglomerate $agglomerateId ($tracingId)",
        `type` = Some(TreeTypeProto.AGGLOMERATE)
      ))

    val skeleton = SkeletonTracingDefaults.createInstance.copy(
      datasetName = "",
      trees = trees
    )
    skeleton.toByteArray
  }

  def getBaseSegmentToAgglomerate(
      baseMappingName: String,
      segmentIds: Set[Long],
      remoteFallbackLayer: RemoteFallbackLayer)(implicit tc: TokenContext): Fox[Map[Long, Long]] = {
    val segmentIdsOrdered = segmentIds.toList
    for {
      agglomerateIdsOrdered <- remoteDatastoreClient.getAgglomerateIdsForSegmentIds(remoteFallbackLayer,
                                                                                    baseMappingName,
                                                                                    segmentIdsOrdered)
    } yield segmentIdsOrdered.zip(agglomerateIdsOrdered).toMap
  }

  def collectSegmentIds(bytes: Array[Byte], elementClass: ElementClass.Value): Box[Set[Long]] =
    tryo(
      nativeBucketScanner
        .collectSegmentIds(bytes,
                           ElementClass.bytesPerElement(elementClass),
                           ElementClass.isSigned(elementClass),
                           skipZeroes = false)
        .toSet)

  def mapData(unmappedData: Array[Byte],
              relevantMapping: Map[Long, Long],
              elementClass: ElementClassProto): Fox[Array[Byte]] =
    for {
      unmappedDataTyped <- bytesToSegmentInt(unmappedData, elementClass)
      mappedDataLongs = unmappedDataTyped.map(element => relevantMapping(element.toLong))
      bytes <- longsToBytes(mappedDataLongs, elementClass)
    } yield bytes

  private def bytesToLongs(bytes: Array[Byte], elementClass: ElementClassProto): Fox[Array[Long]] =
    for {
      _ <- Fox.fromBool(!elementClass.isuint64)
      segmentIntArray <- tryo(SegmentIntegerArray.fromByteArray(bytes, elementClass)).toFox
    } yield segmentIntArray.map(_.toLong)

  private def bytesToSegmentInt(bytes: Array[Byte], elementClass: ElementClassProto): Fox[Array[SegmentInteger]] =
    for {
      _ <- Fox.fromBool(!elementClass.isuint64)
      segmentIntArray <- tryo(SegmentIntegerArray.fromByteArray(bytes, elementClass)).toFox
    } yield segmentIntArray

  private def longsToBytes(longs: Array[Long], elementClass: ElementClassProto): Fox[Array[Byte]] =
    for {
      _ <- Fox.fromBool(!elementClass.isuint64)
      segmentIntArray: Array[SegmentInteger] = longs.map(SegmentInteger.fromLongWithElementClass(_, elementClass))
      bytes = SegmentIntegerArray.toByteArray(segmentIntArray, elementClass)
    } yield bytes

  def createAdHocMesh(editableMappingLayer: EditableMappingLayer, request: WebknossosAdHocMeshRequest)(
      implicit tc: TokenContext): Fox[(Array[Float], List[Int])] = {
    val adHocMeshRequest = AdHocMeshRequest(
      dataSourceId = None,
      dataLayer = editableMappingLayer,
      cuboid = request.cuboid(editableMappingLayer),
      segmentId = request.segmentId,
      voxelSizeFactor = request.voxelSizeFactorInUnit,
      tokenContext = tc,
      mapping = None,
      mappingType = None,
      findNeighbors = request.findNeighbors
    )
    adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
  }

  def getAgglomerateGraphForId(tracingId: String, version: Long, agglomerateId: Long): Fox[AgglomerateGraph] =
    for {
      agglomerateGraph <- agglomerateToGraphCache.getOrLoad(
        (tracingId, agglomerateId, version),
        _ =>
          for {
            graphBytes: VersionedKeyValuePair[Array[Byte]] <- tracingDataStore.editableMappingsAgglomerateToGraph
              .get(agglomerateGraphKey(tracingId, agglomerateId), Some(version), mayBeEmpty = Some(true))
            graphParsed <- if (isRevertedElement(graphBytes.value)) Fox.empty
            else fromProtoBytes[AgglomerateGraph](graphBytes.value).toFox
          } yield graphParsed
      )
    } yield agglomerateGraph

  def getAgglomerateGraphForIdWithFallback(
      mapping: EditableMappingInfo,
      tracingId: String,
      version: Long,
      agglomerateId: Long,
      remoteFallbackLayer: RemoteFallbackLayer)(implicit tc: TokenContext): Fox[AgglomerateGraph] =
    for {
      agglomerateGraphBox <- getAgglomerateGraphForId(tracingId, version, agglomerateId).shiftBox
      agglomerateGraph <- agglomerateGraphBox match {
        case Full(agglomerateGraph) => Fox.successful(agglomerateGraph)
        case Empty =>
          remoteDatastoreClient.getAgglomerateGraph(remoteFallbackLayer, mapping.baseMappingName, agglomerateId)
        case f: Failure => f.toFox
      }
    } yield agglomerateGraph

  def agglomerateGraphMinCut(
      tracingId: String,
      version: Long,
      editableMappingInfo: EditableMappingInfo,
      parameters: MinCutParameters,
      remoteFallbackLayer: RemoteFallbackLayer)(implicit tc: TokenContext): Fox[List[EdgeWithPositions]] =
    for {
      // called here to ensure updates are applied
      agglomerateGraph <- getAgglomerateGraphForIdWithFallback(editableMappingInfo,
                                                               tracingId,
                                                               version,
                                                               parameters.agglomerateId,
                                                               remoteFallbackLayer) ?~> "getAgglomerateGraph.failed"
      edgesToCut <- minCut(agglomerateGraph, parameters.segmentId1, parameters.segmentId2).toFox ?~> "Could not calculate min-cut on agglomerate graph."
      edgesWithPositions = annotateEdgesWithPositions(edgesToCut, agglomerateGraph)
    } yield edgesWithPositions

  private def minCut(agglomerateGraph: AgglomerateGraph, segmentId1: Long, segmentId2: Long): Box[List[(Long, Long)]] =
    tryo {
      val g = new SimpleWeightedGraph[Long, DefaultWeightedEdge](classOf[DefaultWeightedEdge])
      agglomerateGraph.segments.foreach { segmentId =>
        g.addVertex(segmentId)
      }
      agglomerateGraph.edges.zip(agglomerateGraph.affinities).foreach {
        case (edge, affinity) =>
          val e = g.addEdge(edge.source, edge.target)
          if (e == null) {
            throw new Exception("Duplicate edge in agglomerate graph. Please check the mapping file.")
          }
          g.setEdgeWeight(e, affinity)
      }
      val minCutImpl = new PushRelabelMFImpl(g)
      minCutImpl.calculateMinCut(segmentId1, segmentId2)
      val sourcePartition: util.Set[Long] = minCutImpl.getSourcePartition
      val minCutEdges: util.Set[DefaultWeightedEdge] = minCutImpl.getCutEdges
      minCutEdges.asScala.toList.map(e =>
        setDirectionForCutting(g.getEdgeSource(e), g.getEdgeTarget(e), sourcePartition))
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

  private def annotateNodesWithPositions(nodes: Seq[Long], agglomerateGraph: AgglomerateGraph): Seq[NodeWithPosition] =
    nodes.map { segmentId =>
      val index = agglomerateGraph.segments.indexOf(segmentId)
      val position = agglomerateGraph.positions(index)
      NodeWithPosition(
        segmentId,
        position
      )
    }

  def agglomerateGraphNeighbors(
      tracingId: String,
      editableMappingInfo: EditableMappingInfo,
      version: Long,
      parameters: NeighborsParameters,
      remoteFallbackLayer: RemoteFallbackLayer)(implicit tc: TokenContext): Fox[(Long, Seq[NodeWithPosition])] =
    for {
      agglomerateGraph <- getAgglomerateGraphForIdWithFallback(editableMappingInfo,
                                                               tracingId,
                                                               version,
                                                               parameters.agglomerateId,
                                                               remoteFallbackLayer)
      neighborNodes = neighbors(agglomerateGraph, parameters.segmentId)
      nodesWithPositions = annotateNodesWithPositions(neighborNodes, agglomerateGraph)
    } yield (parameters.segmentId, nodesWithPositions)

  private def neighbors(agglomerateGraph: AgglomerateGraph, segmentId: Long): Seq[Long] = {
    val relevantEdges = agglomerateGraph.edges.filter { edge =>
      edge.source == segmentId || edge.target == segmentId
    }
    val neighborNodes = relevantEdges.map { edge =>
      if (edge.source == segmentId) edge.target else edge.source
    }
    neighborNodes
  }

  def getEditedEdges(annotationId: ObjectId,
                     tracingId: String,
                     version: Option[Long],
                     remoteFallbackLayer: RemoteFallbackLayer)(
      implicit tc: TokenContext): Fox[(Seq[(Long, Long)], Seq[(Long, Long)])] = {
    def sortEdge(segmentId1: Long, segmentId2: Long): (Long, Long) =
      if (segmentId1 < segmentId2) (segmentId1, segmentId2) else (segmentId2, segmentId1)

    for {
      updateGroups <- tracingDataStore.annotationUpdates.getMultipleVersionsAsVersionValueTuple(
        annotationId.toString,
        newestVersion = version)(fromJsonBytes[List[UpdateAction]])
      updatesIroned: Seq[UpdateAction] = ironOutReverts(updateGroups)
      addedEdgesSetMutable = scala.collection.mutable.HashSet[(Long, Long)]()
      removedEdgesSetMutable = scala.collection.mutable.HashSet[(Long, Long)]()
      _ <- Fox.serialCombined(updatesIroned) {
        case update: SplitAgglomerateUpdateAction if update.actionTracingId == tracingId =>
          for {
            segmentId1 <- findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                          update.segmentPosition1,
                                                          update.segmentId1,
                                                          update.mag)
            segmentId2 <- findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                          update.segmentPosition2,
                                                          update.segmentId2,
                                                          update.mag)
            sortedEdge = sortEdge(segmentId1, segmentId2)
            _ = addedEdgesSetMutable.remove(sortedEdge)
            _ = removedEdgesSetMutable.add(sortedEdge)
          } yield ()
        case update: MergeAgglomerateUpdateAction if update.actionTracingId == tracingId =>
          for {
            segmentId1 <- findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                          update.segmentPosition1,
                                                          update.segmentId1,
                                                          update.mag)
            segmentId2 <- findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                          update.segmentPosition2,
                                                          update.segmentId2,
                                                          update.mag)
            sortedEdge = sortEdge(segmentId1, segmentId2)
            _ = addedEdgesSetMutable.add(sortedEdge)
            _ = removedEdgesSetMutable.remove(sortedEdge)
          } yield ()
        case _ => Fox.successful(())
      }
    } yield (addedEdgesSetMutable.toSeq, removedEdgesSetMutable.toSeq)
  }
}
