package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.google.inject.Inject
import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.EditableMapping.{AgglomerateEdge, AgglomerateGraph, EditableMappingProto}
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
import net.liftweb.common.{Box, Empty, Full}
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

case class EditableMappingKey(
    editableMappingId: String,
    remoteFallbackLayer: RemoteFallbackLayer,
    userToken: Option[String],
    desiredVersion: Long
)

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

  private def generateId: String = UUID.randomUUID.toString

  val binaryDataService = new BinaryDataService(Paths.get(""), 100, None, None, None)
  isosurfaceServiceHolder.tracingStoreIsosurfaceConfig = (binaryDataService, 30 seconds, 1)
  val isosurfaceService: IsosurfaceService = isosurfaceServiceHolder.tracingStoreIsosurfaceService

  private lazy val materializedEditableMappingCache: AlfuFoxCache[EditableMappingKey, EditableMapping] = AlfuFoxCache(
    maxEntries = 50)

  def newestMaterializableVersion(editableMappingId: String): Fox[Long] =
    tracingDataStore.editableMappingUpdates.getVersion(editableMappingId,
                                                       mayBeEmpty = Some(true),
                                                       emptyFallback = Some(0L))

  def infoJson(tracingId: String, editableMapping: EditableMapping, editableMappingId: String): Fox[JsObject] =
    for {
      version <- newestMaterializableVersion(editableMappingId)
    } yield
      Json.obj(
        "mappingName" -> editableMappingId,
        "version" -> version,
        "tracingId" -> tracingId,
        "baseMappingName" -> editableMapping.baseMappingName,
        "createdTimestamp" -> editableMapping.createdTimestamp
      )

  def create(baseMappingName: String): Fox[(String, EditableMapping)] = {
    val newId = generateId
    val newEditableMapping = EditableMapping(
      baseMappingName = baseMappingName,
      segmentToAgglomerate = Map(),
      agglomerateToGraph = Map(),
      createdTimestamp = System.currentTimeMillis()
    )
    for {
      _ <- tracingDataStore.editableMappings.put(newId, 0L, toProtoBytes(newEditableMapping.toProto))
    } yield (newId, newEditableMapping)
  }

  def exists(editableMappingId: String): Fox[Boolean] =
    for {
      versionOrMinusOne: Long <- tracingDataStore.editableMappings.getVersion(editableMappingId,
                                                                              mayBeEmpty = Some(true),
                                                                              version = Some(0L),
                                                                              emptyFallback = Some(-1L))
    } yield versionOrMinusOne >= 0

  def duplicate(editableMappingIdOpt: Option[String],
                tracing: VolumeTracing,
                tracingId: String,
                userToken: Option[String]): Fox[String] =
    for {
      editableMappingId <- editableMappingIdOpt ?~> "duplicate on editable mapping without id"
      remoteFallbackLayer <- remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
      editableMapping <- get(editableMappingId, remoteFallbackLayer, userToken)
      newId = generateId
      _ <- tracingDataStore.editableMappings.put(newId, 0L, toProtoBytes(editableMapping.toProto))
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

  def get(editableMappingId: String,
          remoteFallbackLayer: RemoteFallbackLayer,
          userToken: Option[String],
          version: Option[Long] = None): Fox[EditableMapping] =
    for {
      desiredVersion <- findDesiredOrNewestPossibleVersion(editableMappingId, version)
      materialized <- getWithCache(editableMappingId, remoteFallbackLayer, userToken, desiredVersion)
    } yield materialized

  private def getWithCache(editableMappingId: String,
                           remoteFallbackLayer: RemoteFallbackLayer,
                           userToken: Option[String],
                           desiredVersion: Long,
  ): Fox[EditableMapping] = {
    val key = EditableMappingKey(editableMappingId, remoteFallbackLayer, userToken, desiredVersion)
    materializedEditableMappingCache.getOrLoad(
      key,
      key => getVersioned(key.editableMappingId, key.remoteFallbackLayer, key.userToken, key.desiredVersion))
  }

  private def getVersioned(editableMappingId: String,
                           remoteFallbackLayer: RemoteFallbackLayer,
                           userToken: Option[String],
                           desiredVersion: Long,
  ): Fox[EditableMapping] =
    for {
      closestMaterializedVersion: VersionedKeyValuePair[EditableMapping] <- tracingDataStore.editableMappings
        .get(editableMappingId, Some(desiredVersion))(bytes =>
          fromProtoBytes[EditableMappingProto](bytes).map(EditableMapping.fromProto))
      materialized <- applyPendingUpdates(
        editableMappingId,
        desiredVersion,
        closestMaterializedVersion.value,
        remoteFallbackLayer,
        closestMaterializedVersion.version,
        userToken
      )
      _ <- Fox.runIf(shouldPersistMaterialized(closestMaterializedVersion.version, desiredVersion)) {
        tracingDataStore.editableMappings.put(editableMappingId, desiredVersion, materialized.toProto)
      }
    } yield materialized

  private def shouldPersistMaterialized(previouslyMaterializedVersion: Long, newVersion: Long): Boolean =
    newVersion > previouslyMaterializedVersion && newVersion % 10 == 5

  private def findDesiredOrNewestPossibleVersion(editableMappingId: String, desiredVersion: Option[Long]): Fox[Long] =
    /*
     * Determines the newest saved version from the updates column.
     * if there are no updates at all, assume mapping is brand new,
     * hence the emptyFallbck tracing.version)
     */
    for {
      newestUpdateVersion <- newestMaterializableVersion(editableMappingId)
    } yield {
      desiredVersion match {
        case None              => newestUpdateVersion
        case Some(desiredSome) => math.min(desiredSome, newestUpdateVersion)
      }
    }

  private def applyPendingUpdates(editableMappingId: String,
                                  desiredVersion: Long,
                                  existingEditableMapping: EditableMapping,
                                  remoteFallbackLayer: RemoteFallbackLayer,
                                  existingVersion: Long,
                                  userToken: Option[String]): Fox[EditableMapping] = {

    def updateIter(mappingFox: Fox[EditableMapping],
                   remainingUpdates: List[EditableMappingUpdateAction]): Fox[EditableMapping] =
      mappingFox.futureBox.flatMap {
        case Empty => Fox.empty
        case Full(mapping) =>
          remainingUpdates match {
            case List() => Fox.successful(mapping)
            case head :: tail =>
              updateIter(applyOneUpdate(mapping, head, remoteFallbackLayer, userToken), tail)
          }
        case _ => mappingFox
      }

    for {
      pendingUpdates <- findPendingUpdates(editableMappingId, existingVersion, desiredVersion)
      appliedEditableMapping <- updateIter(Some(existingEditableMapping), pendingUpdates)
    } yield appliedEditableMapping
  }

  private def applyOneUpdate(mapping: EditableMapping,
                             update: EditableMappingUpdateAction,
                             remoteFallbackLayer: RemoteFallbackLayer,
                             userToken: Option[String]): Fox[EditableMapping] =
    update match {
      case splitAction: SplitAgglomerateUpdateAction =>
        applySplitAction(mapping, splitAction, remoteFallbackLayer, userToken)
      case mergeAction: MergeAgglomerateUpdateAction =>
        applyMergeAction(mapping, mergeAction, remoteFallbackLayer, userToken)
    }

  private def applySplitAction(mapping: EditableMapping,
                               update: SplitAgglomerateUpdateAction,
                               remoteFallbackLayer: RemoteFallbackLayer,
                               userToken: Option[String]): Fox[EditableMapping] =
    for {
      agglomerateGraph <- agglomerateGraphForId(mapping, update.agglomerateId, remoteFallbackLayer, userToken)
      segmentId1 <- findSegmentIdAtPosition(remoteFallbackLayer, update.segmentPosition1, update.mag, userToken)
      segmentId2 <- findSegmentIdAtPosition(remoteFallbackLayer, update.segmentPosition2, update.mag, userToken)
      largestExistingAgglomerateId <- largestAgglomerateId(mapping, remoteFallbackLayer, userToken)
      agglomerateId2 = largestExistingAgglomerateId + 1L
      (graph1, graph2) = splitGraph(agglomerateGraph, segmentId1, segmentId2)
      splitSegmentToAgglomerate = graph2.segments.map(_ -> agglomerateId2).toMap
    } yield
      EditableMapping(
        mapping.baseMappingName,
        segmentToAgglomerate = mapping.segmentToAgglomerate ++ splitSegmentToAgglomerate,
        agglomerateToGraph = mapping.agglomerateToGraph ++ Map(update.agglomerateId -> graph1,
                                                               agglomerateId2 -> graph2),
        createdTimestamp = mapping.createdTimestamp
      )

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

  private def largestAgglomerateId(mapping: EditableMapping,
                                   remoteFallbackLayer: RemoteFallbackLayer,
                                   userToken: Option[String]): Fox[Long] =
    for {
      largestBaseAgglomerateId <- remoteDatastoreClient.getLargestAgglomerateId(remoteFallbackLayer,
                                                                                mapping.baseMappingName,
                                                                                userToken)
      keySet = mapping.agglomerateToGraph.keySet
    } yield math.max(if (keySet.isEmpty) 0L else keySet.max, largestBaseAgglomerateId)

  private def applyMergeAction(mapping: EditableMapping,
                               update: MergeAgglomerateUpdateAction,
                               remoteFallbackLayer: RemoteFallbackLayer,
                               userToken: Option[String]): Fox[EditableMapping] =
    for {
      segmentId1 <- findSegmentIdAtPosition(remoteFallbackLayer, update.segmentPosition1, update.mag, userToken)
      segmentId2 <- findSegmentIdAtPosition(remoteFallbackLayer, update.segmentPosition2, update.mag, userToken)
      agglomerateGraph1 <- agglomerateGraphForId(mapping, update.agglomerateId1, remoteFallbackLayer, userToken)
      agglomerateGraph2 <- agglomerateGraphForId(mapping, update.agglomerateId2, remoteFallbackLayer, userToken)
      mergedGraph = mergeGraph(agglomerateGraph1, agglomerateGraph2, segmentId1, segmentId2)
      _ <- bool2Fox(agglomerateGraph2.segments.contains(segmentId2)) ?~> "segment as queried by position is not contained in fetched agglomerate graph"
      mergedSegmentToAgglomerate: Map[Long, Long] = agglomerateGraph2.segments
        .map(s => s -> update.agglomerateId1)
        .toMap
    } yield
      EditableMapping(
        baseMappingName = mapping.baseMappingName,
        segmentToAgglomerate = mapping.segmentToAgglomerate ++ mergedSegmentToAgglomerate,
        agglomerateToGraph = mapping.agglomerateToGraph ++ Map(
          update.agglomerateId1 -> mergedGraph,
          update.agglomerateId2 -> AgglomerateGraph(List.empty, List.empty, List.empty, List.empty)),
        createdTimestamp = mapping.createdTimestamp
      )

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

  private def agglomerateGraphForId(mapping: EditableMapping,
                                    agglomerateId: Long,
                                    remoteFallbackLayer: RemoteFallbackLayer,
                                    userToken: Option[String]): Fox[AgglomerateGraph] =
    if (mapping.agglomerateToGraph.contains(agglomerateId)) {
      Fox.successful(mapping.agglomerateToGraph(agglomerateId))
    } else {
      remoteDatastoreClient.getAgglomerateGraph(remoteFallbackLayer, mapping.baseMappingName, agglomerateId, userToken)
    }

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

  private def findPendingUpdates(editableMappingId: String, existingVersion: Long, desiredVersion: Long)(
      implicit ec: ExecutionContext): Fox[List[EditableMappingUpdateAction]] =
    if (desiredVersion == existingVersion) Fox.successful(List())
    else {
      for {
        updates <- tracingDataStore.editableMappingUpdates.getMultipleVersions(
          editableMappingId,
          Some(desiredVersion),
          Some(existingVersion + 1)
        )(fromJsonBytes[List[EditableMappingUpdateAction]])
      } yield updates.reverse.flatten
    }

  def update(editableMappingId: String, updateActionGroup: EditableMappingUpdateActionGroup, version: Long): Fox[Unit] =
    for {
      actionsWithTimestamp <- Fox.successful(updateActionGroup.actions.map(_.addTimestamp(updateActionGroup.timestamp)))
      _ <- tracingDataStore.editableMappingUpdates.put(editableMappingId, version, actionsWithTimestamp)
    } yield ()

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

  def generateCombinedMappingSubset(segmentIds: Set[Long],
                                    editableMapping: EditableMapping,
                                    remoteFallbackLayer: RemoteFallbackLayer,
                                    userToken: Option[String]): Fox[Map[Long, Long]] = {
    val segmentIdsInEditableMapping: Set[Long] = segmentIds.intersect(editableMapping.segmentToAgglomerate.keySet)
    val segmentIdsInBaseMapping: Set[Long] = segmentIds.diff(segmentIdsInEditableMapping)
    val editableMappingSubset =
      segmentIdsInEditableMapping.map(segmentId => segmentId -> editableMapping.segmentToAgglomerate(segmentId)).toMap
    for {
      baseMappingSubset <- getBaseSegmentToAgglomeate(editableMapping.baseMappingName,
                                                      segmentIdsInBaseMapping,
                                                      remoteFallbackLayer,
                                                      userToken)
    } yield editableMappingSubset ++ baseMappingSubset
  }

  def getAgglomerateSkeletonWithFallback(editableMappingId: String,
                                         remoteFallbackLayer: RemoteFallbackLayer,
                                         agglomerateId: Long,
                                         userToken: Option[String]): Fox[Array[Byte]] =
    for {
      editableMapping <- get(editableMappingId, remoteFallbackLayer, userToken)
      agglomerateIdIsPresent = editableMapping.agglomerateToGraph.contains(agglomerateId)
      skeletonBytes <- if (agglomerateIdIsPresent)
        getAgglomerateSkeleton(editableMappingId, editableMapping, remoteFallbackLayer, agglomerateId)
      else
        remoteDatastoreClient.getAgglomerateSkeleton(userToken,
                                                     remoteFallbackLayer,
                                                     editableMapping.baseMappingName,
                                                     agglomerateId)
    } yield skeletonBytes

  private def getAgglomerateSkeleton(editableMappingId: String,
                                     editableMapping: EditableMapping,
                                     remoteFallbackLayer: RemoteFallbackLayer,
                                     agglomerateId: Long): Fox[Array[Byte]] =
    for {
      graph <- editableMapping.agglomerateToGraph.get(agglomerateId)
      nodeIdStartAtOneOffset = 1
      nodes = graph.positions.zipWithIndex.map {
        case (pos, idx) =>
          NodeDefaults.createInstance.copy(
            id = idx + nodeIdStartAtOneOffset,
            position = pos
          )
      }
      segmentIdToNodeIdMinusOne: Map[Long, Int] = graph.segments.zipWithIndex.toMap
      skeletonEdges = graph.edges.map { e =>
        Edge(source = segmentIdToNodeIdMinusOne(e.source) + nodeIdStartAtOneOffset,
             target = segmentIdToNodeIdMinusOne(e.target) + nodeIdStartAtOneOffset)
      }

      trees = Seq(
        Tree(
          treeId = math.abs(agglomerateId.toInt), // used only to deterministically select tree color
          createdTimestamp = System.currentTimeMillis(),
          nodes = nodes,
          edges = skeletonEdges,
          name = s"agglomerate $agglomerateId ($editableMappingId)"
        ))

      skeleton = SkeletonTracingDefaults.createInstance.copy(
        dataSetName = remoteFallbackLayer.dataSetName,
        trees = trees
      )
    } yield skeleton.toByteArray

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

  def longsToBytes(longs: Array[Long], elementClass: ElementClass): Fox[Array[Byte]] =
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
      mapping <- get(parameters.editableMappingId, remoteFallbackLayer, userToken)
      agglomerateGraph <- agglomerateGraphForId(mapping, parameters.agglomerateId, remoteFallbackLayer, userToken)
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
