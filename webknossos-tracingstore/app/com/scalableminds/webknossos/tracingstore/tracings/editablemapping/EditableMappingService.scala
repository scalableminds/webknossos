package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.EditableMapping.EditableMappingProto
import com.scalableminds.webknossos.datastore.SegmentToAgglomerateProto.{
  SegmentAgglomeratePair,
  SegmentToAgglomerateProto
}
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
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import org.jgrapht.alg.flow.PushRelabelMFImpl
import org.jgrapht.graph.{DefaultWeightedEdge, SimpleWeightedGraph}
import play.api.libs.json.{JsObject, JsValue, Json, OFormat}

import java.nio.file.Paths
import java.util
import java.util.UUID
import scala.collection.mutable
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
    with ProtoGeometryImplicits {

  private val defaultSegmentToAgglomerateChunkSize = 256 * 1024 // 256 KiB chunks

  private def generateId: String = UUID.randomUUID.toString

  val binaryDataService = new BinaryDataService(Paths.get(""), 100, None, None, None)
  isosurfaceServiceHolder.tracingStoreIsosurfaceConfig = (binaryDataService, 30 seconds, 1)
  val isosurfaceService: IsosurfaceService = isosurfaceServiceHolder.tracingStoreIsosurfaceService

  def currentVersion(editableMappingId: String): Fox[Long] =
    tracingDataStore.editableMappings.getVersion(editableMappingId, mayBeEmpty = Some(true), emptyFallback = Some(0L))

  def infoJson(tracingId: String, editableMapping: EditableMappingProto, editableMappingId: String): Fox[JsObject] =
    for {
      version <- currentVersion(editableMappingId)
    } yield
      Json.obj(
        "mappingName" -> editableMappingId,
        "version" -> version,
        "tracingId" -> tracingId,
        "baseMappingName" -> editableMapping.baseMappingName,
        "createdTimestamp" -> editableMapping.createdTimestamp
      )

  def create(baseMappingName: String): Fox[(String, EditableMappingProto)] = {
    val newId = generateId
    val newEditableMapping = EditableMappingProto(
      baseMappingName = baseMappingName,
      createdTimestamp = System.currentTimeMillis(),
      largestAgglomerateId = 0L
    )
    for {
      _ <- tracingDataStore.editableMappings.put(newId, 0L, toProtoBytes(newEditableMapping))
    } yield (newId, newEditableMapping)
  }

  def exists(editableMappingId: String): Fox[Boolean] =
    for {
      versionOrMinusOne: Long <- tracingDataStore.editableMappings.getVersion(editableMappingId,
                                                                              mayBeEmpty = Some(true),
                                                                              version = Some(0L),
                                                                              emptyFallback = Some(-1L))
    } yield versionOrMinusOne >= 0

  def duplicate(editableMappingIdOpt: Option[String], tracing: VolumeTracing, tracingId: String): Fox[String] =
    for {
      editableMappingId <- editableMappingIdOpt ?~> "duplicate on editable mapping without id"
      editableMapping <- getInfo(editableMappingId)
      newId = generateId
      _ <- tracingDataStore.editableMappings.put(newId, 0L, toProtoBytes(editableMapping))
      // TODO: duplicate agglomerateToGraph, segmentToAgglomerate
    } yield newId

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

  def getInfo(editableMappingId: String, version: Option[Long] = None): Fox[EditableMappingProto] =
    tracingDataStore.editableMappings.get(editableMappingId, version)(fromProtoBytes[EditableMappingProto]).map(_.value)

  def update(editableMappingId: String,
             updateActionGroup: EditableMappingUpdateActionGroup,
             version: Long,
             remoteFallbackLayer: RemoteFallbackLayer,
             userToken: Option[String]): Fox[Unit] =
    for {
      actionsWithTimestamp <- Fox.successful(updateActionGroup.actions.map(_.addTimestamp(updateActionGroup.timestamp)))
      _ <- tracingDataStore.editableMappingUpdates.put(editableMappingId, version, actionsWithTimestamp)
      editableMappingInfo <- getInfo(editableMappingId)
      _ <- applyUpdates(editableMappingId,
                        version,
                        updateActionGroup.actions,
                        editableMappingInfo,
                        remoteFallbackLayer,
                        userToken)
    } yield ()

  private def applyUpdates(editableMappingId: String,
                           newVersion: Long,
                           updates: List[EditableMappingUpdateAction],
                           existingEditabeMappingInfo: EditableMappingProto,
                           remoteFallbackLayer: RemoteFallbackLayer,
                           userToken: Option[String]): Fox[Unit] = {

    def updateIter(mappingFox: Fox[EditableMappingProto],
                   remainingUpdates: List[EditableMappingUpdateAction]): Fox[EditableMappingProto] =
      mappingFox.futureBox.flatMap {
        case Empty => Fox.empty
        case Full(mapping) =>
          remainingUpdates match {
            case List() => Fox.successful(mapping)
            case head :: tail => // TODO: count versions or assert only one update?
              updateIter(applyOneUpdate(mapping, editableMappingId, newVersion, head, remoteFallbackLayer, userToken),
                         tail)
          }
        case _ => mappingFox
      }

    for {
      updatedInfo <- updateIter(Some(existingEditabeMappingInfo), updates)
      _ <- tracingDataStore.editableMappings.put(editableMappingId, newVersion, updatedInfo)
    } yield ()
  }

  private def applyOneUpdate(mapping: EditableMappingProto,
                             editableMappingId: String,
                             newVersion: Long,
                             update: EditableMappingUpdateAction,
                             remoteFallbackLayer: RemoteFallbackLayer,
                             userToken: Option[String]): Fox[EditableMappingProto] =
    update match {
      case splitAction: SplitAgglomerateUpdateAction =>
        applySplitAction(mapping, editableMappingId, newVersion, splitAction, remoteFallbackLayer, userToken)
      case mergeAction: MergeAgglomerateUpdateAction =>
        applyMergeAction(mapping, editableMappingId, newVersion, mergeAction, remoteFallbackLayer, userToken)
    }

  private def applySplitAction(editableMappingInfo: EditableMappingProto,
                               editableMappingId: String,
                               newVersion: Long,
                               update: SplitAgglomerateUpdateAction,
                               remoteFallbackLayer: RemoteFallbackLayer,
                               userToken: Option[String]): Fox[EditableMappingProto] =
    for {
      agglomerateGraph <- agglomerateGraphForIdWithFallback(editableMappingInfo,
                                                            editableMappingId,
                                                            Some(newVersion - 1L),
                                                            update.agglomerateId,
                                                            remoteFallbackLayer,
                                                            userToken)
      segmentId1 <- findSegmentIdAtPosition(remoteFallbackLayer, update.segmentPosition1, update.mag, userToken)
      segmentId2 <- findSegmentIdAtPosition(remoteFallbackLayer, update.segmentPosition2, update.mag, userToken)
      largestExistingAgglomerateId <- largestAgglomerateId(editableMappingInfo, remoteFallbackLayer, userToken)
      agglomerateId2 = largestExistingAgglomerateId + 1L
      (graph1, graph2) = splitGraph(agglomerateGraph, segmentId1, segmentId2)
      _ <- updateSegmentToAgglomerate(editableMappingId, newVersion, graph2.segments, agglomerateId2)
      _ <- updateAgglomerateGraph(editableMappingId, newVersion, update.agglomerateId, graph1)
      _ <- updateAgglomerateGraph(editableMappingId, newVersion, agglomerateId2, graph2)
    } yield editableMappingInfo.withLargestAgglomerateId(agglomerateId2)

  private def updateSegmentToAgglomerate(mappingId: String,
                                         newVersion: Long,
                                         segmentIdsToUpdate: Seq[Long],
                                         agglomerateId: Long): Fox[Unit] =
    for {
      chunkedSegmentIds: Map[Long, Seq[Long]] <- Fox.successful(
        segmentIdsToUpdate.groupBy(_ / defaultSegmentToAgglomerateChunkSize))
      _ <- Fox.serialCombined(chunkedSegmentIds.keys.toList) { chunkId =>
        updateSegmentToAgglomerateChunk(mappingId, newVersion, agglomerateId, chunkId, chunkedSegmentIds(chunkId))
      }
    } yield ()

  private def updateSegmentToAgglomerateChunk(editableMappingId: String,
                                              newVersion: Long,
                                              agglomerateId: Long,
                                              chunkId: Long,
                                              segmentIdsToUpdate: Seq[Long]): Fox[Unit] =
    for {
      existingChunk: Seq[(Long, Long)] <- getSegmentToAgglomerateChunk(editableMappingId,
                                                                       chunkId,
                                                                       Set.empty,
                                                                       filterSelected = false)
      chunkMap = existingChunk.toMap
      mergedMap = chunkMap ++ segmentIdsToUpdate.map(_ -> agglomerateId).toMap
      proto = SegmentToAgglomerateProto(mergedMap.toVector.map { segmentAgglomerateTuple =>
        SegmentAgglomeratePair(segmentAgglomerateTuple._1, segmentAgglomerateTuple._2)
      })
      _ <- tracingDataStore.editableMappingsSegmentToAgglomerate.put(
        segmentToAgglomerateKey(editableMappingId, agglomerateId),
        newVersion,
        proto.toByteArray)
    } yield ()

  private def updateAgglomerateGraph(mappingId: String,
                                     newVersion: Long,
                                     agglomerateId: Long,
                                     graph: AgglomerateGraph): Fox[Unit] =
    tracingDataStore.editableMappingsAgglomerateToGraph.put(agglomerateGraphKey(mappingId, agglomerateId),
                                                           newVersion,
                                                           graph)

  private def splitGraph(agglomerateGraph: AgglomerateGraph,
                         segmentId1: Long,
                         segmentId2: Long): (AgglomerateGraph, AgglomerateGraph) = {
    val edgesAndAffinitiesMinusOne: Seq[(AgglomerateEdge, Float)] =
      agglomerateGraph.edges.zip(agglomerateGraph.affinities).filterNot {
        case (AgglomerateEdge(from, to, _), _) =>
          (from == segmentId1 && to == segmentId2) || (from == segmentId2 && to == segmentId1)
      }
    val graph1Nodes: Set[Long] = computeConnectedComponent(startNode = segmentId1, edgesAndAffinitiesMinusOne.map(_._1))
    val graph1NodesWithPositions = agglomerateGraph.segments.zip(agglomerateGraph.positions).filter {
      case (seg, _) => graph1Nodes.contains(seg)
    }
    val graph1EdgesWithAffinities = edgesAndAffinitiesMinusOne.filter {
      case (e, _) => graph1Nodes.contains(e.source) && graph1Nodes.contains(e.target)
    }
    val graph1 = AgglomerateGraph(
      segments = graph1NodesWithPositions.map(_._1),
      edges = graph1EdgesWithAffinities.map(_._1),
      positions = graph1NodesWithPositions.map(_._2),
      affinities = graph1EdgesWithAffinities.map(_._2),
    )

    val graph2Nodes: Set[Long] = agglomerateGraph.segments.toSet.diff(graph1Nodes)
    val graph2NodesWithPositions = agglomerateGraph.segments.zip(agglomerateGraph.positions).filter {
      case (seg, _) => graph2Nodes.contains(seg)
    }
    val graph2EdgesWithAffinities = edgesAndAffinitiesMinusOne.filter {
      case (e, _) => graph2Nodes.contains(e.source) && graph2Nodes.contains(e.target)
    }
    val graph2 = AgglomerateGraph(
      segments = graph2NodesWithPositions.map(_._1),
      edges = graph2EdgesWithAffinities.map(_._1),
      positions = graph2NodesWithPositions.map(_._2),
      affinities = graph2EdgesWithAffinities.map(_._2),
    )
    (graph1, graph2)
  }

  private def computeConnectedComponent(startNode: Long, edges: Seq[AgglomerateEdge]): Set[Long] = {
    val neighborsByNode =
      mutable.HashMap[Long, List[Long]]().withDefaultValue(List[Long]())
    edges.foreach { e =>
      neighborsByNode(e.source) = e.target :: neighborsByNode(e.source)
      neighborsByNode(e.target) = e.source :: neighborsByNode(e.target)
    }
    val nodesToVisit = mutable.HashSet[Long](startNode)
    val visitedNodes = mutable.HashSet[Long]()
    while (nodesToVisit.nonEmpty) {
      val node = nodesToVisit.head
      nodesToVisit -= node
      if (!visitedNodes.contains(node)) {
        visitedNodes += node
        nodesToVisit ++= neighborsByNode(node)
      }
    }
    visitedNodes.toSet
  }

  private def largestAgglomerateId(mapping: EditableMappingProto,
                                   remoteFallbackLayer: RemoteFallbackLayer,
                                   userToken: Option[String]): Fox[Long] =
    for {
      largestBaseAgglomerateId <- remoteDatastoreClient.getLargestAgglomerateId(remoteFallbackLayer,
                                                                                mapping.baseMappingName,
                                                                                userToken)
    } yield math.max(mapping.largestAgglomerateId, largestBaseAgglomerateId)

  private def applyMergeAction(mapping: EditableMappingProto,
                               editableMappingId: String,
                               newVersion: Long,
                               update: MergeAgglomerateUpdateAction,
                               remoteFallbackLayer: RemoteFallbackLayer,
                               userToken: Option[String]): Fox[EditableMappingProto] =
    for {
      segmentId1 <- findSegmentIdAtPosition(remoteFallbackLayer, update.segmentPosition1, update.mag, userToken)
      segmentId2 <- findSegmentIdAtPosition(remoteFallbackLayer, update.segmentPosition2, update.mag, userToken)
      agglomerateGraph1 <- agglomerateGraphForIdWithFallback(mapping,
                                                             editableMappingId,
                                                             Some(newVersion - 1),
                                                             update.agglomerateId1,
                                                             remoteFallbackLayer,
                                                             userToken)
      agglomerateGraph2 <- agglomerateGraphForIdWithFallback(mapping,
                                                             editableMappingId,
                                                             Some(newVersion - 1),
                                                             update.agglomerateId2,
                                                             remoteFallbackLayer,
                                                             userToken)
      mergedGraph = mergeGraph(agglomerateGraph1, agglomerateGraph2, segmentId1, segmentId2)
      _ <- bool2Fox(agglomerateGraph2.segments.contains(segmentId2)) ?~> "segment as queried by position is not contained in fetched agglomerate graph"
      _ <- updateSegmentToAgglomerate(editableMappingId, newVersion, agglomerateGraph2.segments, update.agglomerateId1)
      _ <- updateAgglomerateGraph(editableMappingId, newVersion, update.agglomerateId1, mergedGraph)
      _ <- updateAgglomerateGraph(editableMappingId,
                                  newVersion,
                                  update.agglomerateId2,
                                  AgglomerateGraph(List.empty, List.empty, List.empty, List.empty))
    } yield mapping

  private def mergeGraph(agglomerateGraph1: AgglomerateGraph,
                         agglomerateGraph2: AgglomerateGraph,
                         segmentId1: Long,
                         segmentId2: Long): AgglomerateGraph = {
    val newEdge = AgglomerateEdge(segmentId1, segmentId2)
    val newEdgeAffinity = 255.0f
    AgglomerateGraph(
      segments = agglomerateGraph1.segments ++ agglomerateGraph2.segments,
      edges = newEdge +: (agglomerateGraph1.edges ++ agglomerateGraph2.edges),
      affinities = newEdgeAffinity +: (agglomerateGraph1.affinities ++ agglomerateGraph2.affinities),
      positions = agglomerateGraph1.positions ++ agglomerateGraph2.positions
    )
  }

  private def agglomerateGraphKey(mappingId: String, agglomerateId: Long): String =
    s"$mappingId/$agglomerateId"

  private def segmentToAgglomerateKey(mappingId: String, chunkId: Long): String =
    s"$mappingId/$chunkId"

  def agglomerateGraphForId(mappingId: String,
                            agglomerateId: Long,
                            version: Option[Long] = None): Fox[AgglomerateGraph] =
    for {
      keyValuePair: VersionedKeyValuePair[AgglomerateGraph] <- tracingDataStore.editableMappingsAgglomerateToGraph.get(
        agglomerateGraphKey(mappingId, agglomerateId),
        version,
        mayBeEmpty = Some(true))(fromProtoBytes[AgglomerateGraph])
    } yield keyValuePair.value

  private def agglomerateGraphForIdWithFallback(mapping: EditableMappingProto,
                                                editableMappingId: String,
                                                version: Option[Long],
                                                agglomerateId: Long,
                                                remoteFallbackLayer: RemoteFallbackLayer,
                                                userToken: Option[String]): Fox[AgglomerateGraph] =
    for {
      agglomerateGraphBox <- agglomerateGraphForId(editableMappingId, agglomerateId, version).futureBox
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

  private def findSegmentIdAtPosition(remoteFallbackLayer: RemoteFallbackLayer,
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
                                                 editableMappingId: String): Fox[Map[Long, Long]] = {
    val chunkIds = segmentIds.map(_ / defaultSegmentToAgglomerateChunkSize)
    for { // TODO: optimization: fossil-multiget
      maps: List[Seq[(Long, Long)]] <- Fox.serialCombined(chunkIds.toList)(chunkId =>
        getSegmentToAgglomerateChunk(editableMappingId, chunkId, segmentIds, filterSelected = true))
    } yield maps.flatten.toMap
  }

  // TODO remove filterSelected logic, do filtering outside of here if needed
  private def getSegmentToAgglomerateChunk(editableMappingId: String,
                                           chunkId: Long,
                                           segmentIds: Set[Long],
                                           filterSelected: Boolean): Fox[Seq[(Long, Long)]] =
    for {
      chunkBox: Box[SegmentToAgglomerateProto] <- getSegmentToAgglomerateChunkProto(editableMappingId, chunkId).futureBox
      segmentToAgglomerate <- chunkBox match {
        case Full(chunk) => Fox.successful(filterSegmentToAgglomerateChunk(chunk, segmentIds, filterSelected))
        case Empty       => Fox.successful(Seq.empty[(Long, Long)])
        case f: Failure  => f.toFox
      }
    } yield segmentToAgglomerate

  private def filterSegmentToAgglomerateChunk(segmentToAgglomerateProto: SegmentToAgglomerateProto,
                                              segmentIds: Set[Long],
                                              filterSelected: Boolean): Seq[(Long, Long)] =
    if (filterSelected) {
      segmentToAgglomerateProto.segmentToAgglomerate
        .filter(pair => segmentIds.contains(pair.segmentId))
        .map(pair => pair.segmentId -> pair.agglomerateId)
    } else {
      segmentToAgglomerateProto.segmentToAgglomerate.map(pair => pair.segmentId -> pair.agglomerateId)
    }

  private def getSegmentToAgglomerateChunkProto(editableMappingId: String,
                                                agglomerateId: Long,
                                                version: Option[Long] = None): Fox[SegmentToAgglomerateProto] =
    for {
      keyValuePair: VersionedKeyValuePair[SegmentToAgglomerateProto] <- tracingDataStore.editableMappingsSegmentToAgglomerate
        .get(segmentToAgglomerateKey(editableMappingId, agglomerateId), version, mayBeEmpty = Some(true))(
          fromProtoBytes[SegmentToAgglomerateProto])
    } yield keyValuePair.value

  def generateCombinedMappingSubset(segmentIds: Set[Long],
                                    editableMapping: EditableMappingProto,
                                    editableMappingId: String,
                                    remoteFallbackLayer: RemoteFallbackLayer,
                                    userToken: Option[String]): Fox[Map[Long, Long]] =
    for {
      editableMappingSubset <- getSegmentToAgglomerateForSegments(segmentIds, editableMappingId)
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
      editableMapping <- getInfo(editableMappingId)
      agglomerateGraphBox <- agglomerateGraphForId(editableMappingId, agglomerateId).futureBox
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

  def agglomerateGraphMinCut(parameters: MinCutParameters,
                             remoteFallbackLayer: RemoteFallbackLayer,
                             userToken: Option[String]): Fox[List[EdgeWithPositions]] =
    for {
      segmentId1 <- findSegmentIdAtPosition(remoteFallbackLayer, parameters.segmentPosition1, parameters.mag, userToken)
      segmentId2 <- findSegmentIdAtPosition(remoteFallbackLayer, parameters.segmentPosition2, parameters.mag, userToken)
      mapping <- getInfo(parameters.editableMappingId)
      agglomerateGraph <- agglomerateGraphForIdWithFallback(mapping,
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
