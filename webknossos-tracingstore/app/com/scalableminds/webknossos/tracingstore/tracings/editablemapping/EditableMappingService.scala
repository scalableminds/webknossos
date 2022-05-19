package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import java.util.UUID

import akka.http.caching.LfuCache
import akka.http.caching.scaladsl.{Cache, CachingSettings}
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
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Empty, Full}
import play.api.libs.json.{JsObject, JsValue, Json}

import scala.concurrent.duration._
import scala.collection.mutable
import scala.concurrent.ExecutionContext

class EditableMappingService @Inject()(
    val tracingDataStore: TracingDataStore,
    remoteDatastoreClient: TSRemoteDatastoreClient
)(implicit ec: ExecutionContext)
    extends KeyValueStoreImplicits
    with FoxImplicits
    with ProtoGeometryImplicits
    with LazyLogging {

  private def generateId: String = UUID.randomUUID.toString

  private lazy val materializedEditableMappingCache: Cache[String, Box[EditableMapping]] = {
    val maxEntries = 10
    val defaultCachingSettings = CachingSettings("")
    val lfuCacheSettings =
      defaultCachingSettings.lfuCacheSettings
        .withInitialCapacity(maxEntries)
        .withMaxCapacity(maxEntries)
        .withTimeToLive(2 hours)
        .withTimeToIdle(1 hour)
    val cachingSettings =
      defaultCachingSettings.withLfuCacheSettings(lfuCacheSettings)
    val lfuCache: Cache[String, Box[EditableMapping]] = LfuCache(cachingSettings)
    lfuCache
  }

  def newestMaterializableVersion(editableMappingId: String): Fox[Long] =
    tracingDataStore.editableMappingUpdates.getVersion(editableMappingId,
                                                       mayBeEmpty = Some(true),
                                                       emptyFallback = Some(0L))

  def infoJson(tracingId: String, editableMappingId: String): Fox[JsObject] =
    for {
      version <- newestMaterializableVersion(editableMappingId)
    } yield
      Json.obj(
        "mappingName" -> editableMappingId,
        "version" -> version,
        "tracingId" -> tracingId
      )

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

  def updateActionLog(editableMappingId: String): Fox[JsValue] = {
    def versionedTupleToJson(tuple: (Long, List[EditableMappingUpdateAction])): JsObject =
      Json.obj(
        "version" -> tuple._1,
        "value" -> Json.toJson(tuple._2)
      )

    for {
      updates <- tracingDataStore.editableMappingUpdates.getMultipleVersionsAsVersionValueTuple(editableMappingId)(
        fromJson[List[EditableMappingUpdateAction]])
      updateActionGroupsJs = updates.map(versionedTupleToJson)
    } yield Json.toJson(updateActionGroupsJs)
  }

  private def get(editableMappingId: String,
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
    val key = f"$editableMappingId---$desiredVersion"
    for {
      materializedBox <- materializedEditableMappingCache.getOrLoad(
        key,
        _ => getVersioned(editableMappingId, remoteFallbackLayer, userToken, desiredVersion).futureBox)
      materialized <- materializedBox.toFox
    } yield materialized
  }

  private def getVersioned(editableMappingId: String,
                           remoteFallbackLayer: RemoteFallbackLayer,
                           userToken: Option[String],
                           desiredVersion: Long,
  ): Fox[EditableMapping] =
    for {
      closestMaterializedVersion: VersionedKeyValuePair[EditableMapping] <- tracingDataStore.editableMappings
        .get(editableMappingId, Some(desiredVersion))(fromJson[EditableMapping])
      _ = logger.info(
        f"Loading mapping version $desiredVersion, closest materialized is version ${closestMaterializedVersion.version} (${closestMaterializedVersion.value})")
      materialized <- applyPendingUpdates(
        editableMappingId,
        desiredVersion,
        closestMaterializedVersion.value,
        remoteFallbackLayer,
        closestMaterializedVersion.version,
        userToken
      )
      _ = logger.info(s"Materialized mapping: $materialized")
      _ <- Fox.runIf(shouldPersistMaterialized(closestMaterializedVersion.version, desiredVersion)) {
        tracingDataStore.editableMappings.put(editableMappingId, desiredVersion, materialized)
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
      _ = logger.info(s"Applying ${pendingUpdates.length} mapping updates: $pendingUpdates...")
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
      _ = logger.info(
        s"Applying one split action on agglomerate ${update.agglomerateId} (previously $agglomerateGraph)...")
      segmentId1 <- findSegmentIdAtPosition(remoteFallbackLayer, update.segmentPosition1, update.mag, userToken)
      segmentId2 <- findSegmentIdAtPosition(remoteFallbackLayer, update.segmentPosition2, update.mag, userToken)
      largestExistingAgglomerateId <- largestAgglomerateId(mapping, remoteFallbackLayer, userToken)
      agglomerateId2 = largestExistingAgglomerateId + 1L
      (graph1, graph2) = splitGraph(agglomerateGraph, segmentId1, segmentId2)
      _ = logger.info(
        s"Graphs after split: Agglomerate ${update.agglomerateId}: $graph1, Aggloemrate $agglomerateId2: $graph2")
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
    val edgesMinusOne = agglomerateGraph.edges.filterNot {
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
      mutable.HashMap[Long, List[Long]]().withDefaultValue(List[Long]())
    edges.foreach {
      case (from, to) =>
        neighborsByNode(from) = to :: neighborsByNode(from)
        neighborsByNode(to) = from :: neighborsByNode(to)
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
      for {
        updates <- tracingDataStore.editableMappingUpdates.getMultipleVersions(
          editableMappingId,
          Some(desiredVersion),
          Some(existingVersion + 1)
        )(fromJson[List[EditableMappingUpdateAction]])
      } yield updates.reverse.flatten
    }

  def update(editableMappingId: String, updateActionGroup: EditableMappingUpdateActionGroup, version: Long): Fox[Unit] =
    for {
      actionsWithTimestamp <- Fox.successful(updateActionGroup.actions.map(_.addTimestamp(updateActionGroup.timestamp)))
      _ <- tracingDataStore.editableMappingUpdates.put(editableMappingId, version, actionsWithTimestamp)
    } yield ()

  def volumeData(tracing: VolumeTracing,
                 dataRequests: DataRequestCollection,
                 userToken: Option[String]): Fox[(Array[Byte], List[Int])] =
    for {
      editableMappingId <- tracing.mappingName.toFox
      remoteFallbackLayer <- remoteFallbackLayer(tracing)
      editableMapping <- get(editableMappingId, remoteFallbackLayer, userToken)
      (unmappedData, indices) <- getUnmappedDataFromDatastore(remoteFallbackLayer, dataRequests, userToken)
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
        Edge(source = segmentIdToNodeIdMinusOne(e._1) + nodeIdStartAtOneOffset,
             target = segmentIdToNodeIdMinusOne(e._2) + nodeIdStartAtOneOffset)
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
                                           dataRequests: DataRequestCollection,
                                           userToken: Option[String]): Fox[(Array[Byte], List[Int])] =
    for {
      dataRequestsTyped <- Fox.serialCombined(dataRequests) {
        case r: WebKnossosDataRequest => Fox.successful(r.copy(applyAgglomerate = None))
        case _                        => Fox.failure("Editable Mappings currently only work for webKnossos data requests")
      }
      (data, indices) <- remoteDatastoreClient.getData(remoteFallbackLayer, dataRequestsTyped, userToken)
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
