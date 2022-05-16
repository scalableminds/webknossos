package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, Tree}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models.{
  AgglomerateGraph,
  UnsignedInteger,
  UnsignedIntegerArray,
  WebKnossosDataRequest
}
import com.scalableminds.webknossos.tracingstore.TSRemoteDatastoreClient
import com.scalableminds.webknossos.tracingstore.tracings.{
  KeyValueStoreImplicits,
  TracingDataStore,
  VersionedKeyValuePair
}
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Empty, Full}

import scala.collection.mutable
import scala.concurrent.ExecutionContext

class EditableMappingService @Inject()(
    val tracingDataStore: TracingDataStore,
    remoteDatastoreClient: TSRemoteDatastoreClient
)(implicit ec: ExecutionContext)
    extends KeyValueStoreImplicits
    with FoxImplicits
    with ProtoGeometryImplicits {

  private def generateId: String = UUID.randomUUID.toString

  def currentVersion(editableMappingId: String): Fox[Long] =
    tracingDataStore.editableMappings.getVersion(editableMappingId, mayBeEmpty = Some(true), emptyFallback = Some(0L))

  def create(baseMappingName: String): Fox[String] = {
    val newId = generateId
    val newEditableMapping = EditableMapping(
      baseMappingName = baseMappingName,
      segmentToAgglomerate = Map(),
      agglomerateToGraph = Map()
    )
    for {
      _ <- tracingDataStore.editableMappings.put(newId, 0L, newEditableMapping)
    } yield newId
  }

  def exists(editableMappingId: String): Fox[Boolean] =
    for {
      versionOrMinusOne: Long <- tracingDataStore.editableMappings.getVersion(editableMappingId,
                                                                              mayBeEmpty = Some(true),
                                                                              version = Some(0L),
                                                                              emptyFallback = Some(-1L))
    } yield versionOrMinusOne >= 0

  private def get(editableMappingId: String,
                  remoteFallbackLayer: RemoteFallbackLayer,
                  userToken: Option[String],
                  version: Option[Long] = None): Fox[EditableMapping] =
    for {
      closestMaterializedVersion: VersionedKeyValuePair[EditableMapping] <- tracingDataStore.editableMappings
        .get(editableMappingId, version)(fromJson[EditableMapping])
      desiredVersion <- findDesiredOrNewestPossibleVersion(closestMaterializedVersion.version,
                                                           editableMappingId,
                                                           version)
      materialized <- applyPendingUpdates(
        editableMappingId,
        desiredVersion,
        closestMaterializedVersion.value,
        remoteFallbackLayer,
        closestMaterializedVersion.version,
        userToken
      )
      _ <- Fox.runIf(shouldPersistMaterialized(closestMaterializedVersion.version, desiredVersion)) {
        tracingDataStore.editableMappings.put(editableMappingId, desiredVersion, materialized)
      }
    } yield materialized

  private def shouldPersistMaterialized(previouslyMaterializedVersion: Long, newVersion: Long): Boolean =
    newVersion > previouslyMaterializedVersion && newVersion % 10 == 5

  private def findDesiredOrNewestPossibleVersion(existingMaterializedVersion: Long,
                                                 editableMappingId: String,
                                                 desiredVersion: Option[Long]): Fox[Long] =
    /*
     * Determines the newest saved version from the updates column.
     * if there are no updates at all, assume mapping is brand new,
     * hence the emptyFallbck tracing.version)
     */
    for {
      newestUpdateVersion <- tracingDataStore.editableMappingUpdates.getVersion(editableMappingId,
                                                                                mayBeEmpty = Some(true),
                                                                                emptyFallback =
                                                                                  Some(existingMaterializedVersion))
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
        agglomerateToGraph = mapping.agglomerateToGraph ++ Map(update.agglomerateId -> graph1, agglomerateId2 -> graph2)
      )

  private def splitGraph(agglomerateGraph: AgglomerateGraph,
                         segmentId1: Long,
                         segmentId2: Long): (AgglomerateGraph, AgglomerateGraph) = {
    val edgesMinusOne = agglomerateGraph.edges.filter {
      case (from, to) =>
        (from == segmentId1 && to == segmentId2) || (from == segmentId2 && to == segmentId1)
    }
    val graph1Nodes: Set[Long] = computeConnectedComponent(startNode = segmentId1, edgesMinusOne)
    val graph1NodesWithPositions = agglomerateGraph.segments.zip(agglomerateGraph.positions).filter {
      case (seg, _) => graph1Nodes.contains(seg)
    }
    val graph1EdgesWithAffinities = agglomerateGraph.edges.zip(agglomerateGraph.affinities).filter {
      case (e, _) => graph1Nodes.contains(e._1) && graph1Nodes.contains(e._2)
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
    val graph2EdgesWithAffinities = agglomerateGraph.edges.zip(agglomerateGraph.affinities).filter {
      case (e, _) => graph2Nodes.contains(e._1) && graph2Nodes.contains(e._2)
    }
    val graph2 = AgglomerateGraph(
      segments = graph2NodesWithPositions.map(_._1),
      edges = graph2EdgesWithAffinities.map(_._1),
      positions = graph2NodesWithPositions.map(_._2),
      affinities = graph2EdgesWithAffinities.map(_._2),
    )
    (graph1, graph2)
  }

  private def computeConnectedComponent(startNode: Long, edges: List[(Long, Long)]): Set[Long] = {
    val neighborsByNode =
      mutable.HashMap[Long, mutable.MutableList[Long]]().withDefaultValue(mutable.MutableList[Long]())
    edges.foreach {
      case (from, to) =>
        neighborsByNode(from) += to
        neighborsByNode(to) += from
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
        agglomerateToGraph = mapping.agglomerateToGraph ++ Map(update.agglomerateId1 -> mergedGraph,
                                                               update.agglomerateId2 -> AgglomerateGraph.empty)
      )

  private def mergeGraph(agglomerateGraph1: AgglomerateGraph,
                         agglomerateGraph2: AgglomerateGraph,
                         segmentId1: Long,
                         segmentId2: Long): AgglomerateGraph = {
    val newEdge = (segmentId1, segmentId2)
    val newEdgeAffinity = 255L
    AgglomerateGraph(
      segments = agglomerateGraph1.segments ++ agglomerateGraph2.segments,
      edges = newEdge :: (agglomerateGraph1.edges ++ agglomerateGraph2.edges),
      affinities = newEdgeAffinity :: (agglomerateGraph1.affinities ++ agglomerateGraph2.affinities),
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
      tracingDataStore.editableMappingUpdates.getMultipleVersions(
        editableMappingId,
        Some(desiredVersion),
        Some(existingVersion + 1)
      )(fromJson[EditableMappingUpdateAction])
    }

  def update(editableMappingId: String, updateAction: EditableMappingUpdateAction, version: Long): Fox[Unit] =
    for {
      _ <- tracingDataStore.editableMappingUpdates.put(editableMappingId, version, updateAction)
    } yield ()

  def volumeData(tracing: VolumeTracing,
                 dataRequests: DataRequestCollection,
                 userToken: Option[String]): Fox[(Array[Byte], List[Int])] =
    for {
      editableMappingId <- tracing.mappingName.toFox
      remoteFallbackLayer <- remoteFallbackLayer(tracing)
      editableMapping <- get(editableMappingId, remoteFallbackLayer, userToken)
      (unmappedData, indices) <- getUnmappedDataFromDatastore(remoteFallbackLayer, dataRequests)
      segmentIds <- collectSegmentIds(unmappedData, tracing.elementClass)
      relevantMapping <- generateCombinedMappingSubset(segmentIds, editableMapping, remoteFallbackLayer, userToken)
      mappedData <- mapData(unmappedData, relevantMapping, tracing.elementClass)
    } yield (mappedData, indices)

  private def generateCombinedMappingSubset(segmentIds: Set[Long],
                                            editableMapping: EditableMapping,
                                            remoteFallbackLayer: RemoteFallbackLayer,
                                            userToken: Option[String]): Fox[Map[Long, Long]] = {
    val segmentIdsInEditableMapping: Set[Long] = segmentIds.intersect(editableMapping.segmentToAgglomerate.keySet)
    val segmentIdsInBaseMapping: Set[Long] = segmentIds.diff(segmentIdsInEditableMapping)
    val editableMappingSubset =
      editableMapping.segmentToAgglomerate.filterKeys(key => segmentIdsInEditableMapping.contains(key))
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
      nodes = graph.positions.zipWithIndex.map {
        case (pos, idx) =>
          NodeDefaults.createInstance.copy(
            id = idx,
            position = pos
          )
      }
      skeletonEdges = graph.edges.map { e =>
        Edge(source = e._1.toInt, target = e._2.toInt)
      }

      trees = Seq(
        Tree(
          treeId = agglomerateId.toInt,
          createdTimestamp = System.currentTimeMillis(),
          nodes = nodes,
          edges = skeletonEdges,
          name = s"agglomerate $agglomerateId ($editableMappingId)"
        ))

      skeleton = SkeletonTracingDefaults.createInstance.copy(
        dataSetName = remoteFallbackLayer.dataSetName,
        trees = trees,
        organizationName = Some(remoteFallbackLayer.organizationName)
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

  private def getUnmappedDataFromDatastore(remoteFallbackLayer: RemoteFallbackLayer,
                                           dataRequests: DataRequestCollection): Fox[(Array[Byte], List[Int])] =
    for {
      dataRequestsTyped <- Fox.serialCombined(dataRequests) {
        case r: WebKnossosDataRequest => Fox.successful(r.copy(applyAgglomerate = None))
        case _                        => Fox.failure("Editable Mappings currently only work for webKnossos data requests")
      }
      (data, indices) <- remoteDatastoreClient.getData(remoteFallbackLayer, dataRequestsTyped)
    } yield (data, indices)

  private def collectSegmentIds(data: Array[Byte], elementClass: ElementClass): Fox[Set[Long]] =
    for {
      dataAsLongs <- bytesToLongs(data, elementClass)
    } yield dataAsLongs.toSet

  def remoteFallbackLayer(tracing: VolumeTracing): Fox[RemoteFallbackLayer] =
    for {
      layerName <- tracing.fallbackLayer.toFox ?~> "This feature is only defined on volume annotations with fallback segmentation layer."
      organizationName <- tracing.organizationName.toFox ?~> "This feature is only implemented for volume annotations with an explicit organization name tag, not for legacy volume annotations."
    } yield RemoteFallbackLayer(organizationName, tracing.dataSetName, layerName, tracing.elementClass)

  private def mapData(unmappedData: Array[Byte],
                      relevantMapping: Map[Long, Long],
                      elementClass: ElementClass): Fox[Array[Byte]] =
    for {
      unmappedDataLongs <- bytesToLongs(unmappedData, elementClass)
      mappedDataLongs = unmappedDataLongs.map(relevantMapping)
      bytes <- longsToBytes(mappedDataLongs, elementClass)
    } yield bytes

  private def bytesToLongs(bytes: Array[Byte], elementClass: ElementClass): Fox[Array[Long]] =
    for {
      _ <- bool2Fox(!elementClass.isuint64)
      unsignedIntArray <- tryo(UnsignedIntegerArray.fromByteArray(bytes, elementClass)).toFox
    } yield unsignedIntArray.map(_.toPositiveLong)

  private def longsToBytes(longs: Array[Long], elementClass: ElementClass): Fox[Array[Byte]] =
    for {
      _ <- bool2Fox(!elementClass.isuint64)
      unsignedIntArray: Array[UnsignedInteger] = longs.map(UnsignedInteger.fromLongWithElementClass(_, elementClass))
      bytes = UnsignedIntegerArray.toByteArray(unsignedIntArray, elementClass)
    } yield bytes

}
