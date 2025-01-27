package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.SegmentToAgglomerateProto.{
  SegmentAgglomeratePair,
  SegmentToAgglomerateProto
}
import com.scalableminds.webknossos.tracingstore.TSRemoteDatastoreClient
import com.scalableminds.webknossos.tracingstore.tracings.{
  KeyValueStoreImplicits,
  RemoteFallbackLayer,
  TracingDataStore
}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Failure, Full}
import net.liftweb.common.Box.tryo
import org.jgrapht.alg.connectivity.ConnectivityInspector
import org.jgrapht.graph.{DefaultEdge, DefaultUndirectedGraph}

import scala.collection.mutable
import scala.concurrent.ExecutionContext
import scala.jdk.CollectionConverters.CollectionHasAsScala

// applies the updates of *one* update group.
// uses mutable maps for the updated keys before flushing them to the db after applying all updates of one group
// this results in only one version increment in the db per update group

class EditableMappingUpdater(
    editableMappingId: String,
    baseMappingName: Option[String],
    oldVersion: Long,
    newVersion: Long,
    remoteFallbackLayer: RemoteFallbackLayer,
    userToken: Option[String],
    remoteDatastoreClient: TSRemoteDatastoreClient,
    editableMappingService: EditableMappingService,
    tracingDataStore: TracingDataStore,
    relyOnAgglomerateIds: Boolean // False during merge and in case of multiple actions. Then, look up all agglomerate ids at positions
) extends KeyValueStoreImplicits
    with FoxImplicits
    with LazyLogging {

  private val segmentToAgglomerateBuffer: mutable.Map[String, Map[Long, Long]] =
    new mutable.HashMap[String, Map[Long, Long]]()
  private val agglomerateToGraphBuffer: mutable.Map[String, AgglomerateGraph] =
    new mutable.HashMap[String, AgglomerateGraph]()

  def applyUpdatesAndSave(existingEditabeMappingInfo: EditableMappingInfo,
                          updates: List[EditableMappingUpdateAction],
                          dry: Boolean = false)(implicit ec: ExecutionContext): Fox[EditableMappingInfo] =
    for {
      updatedEditableMappingInfo: EditableMappingInfo <- updateIter(Some(existingEditabeMappingInfo), updates)
      _ <- Fox.runIf(!dry)(flushToFossil(updatedEditableMappingInfo))
    } yield updatedEditableMappingInfo

  private def flushToFossil(updatedEditableMappingInfo: EditableMappingInfo)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(segmentToAgglomerateBuffer.keys.toList)(flushSegmentToAgglomerateChunk)
      _ <- Fox.serialCombined(agglomerateToGraphBuffer.keys.toList)(flushAgglomerateGraph)
      _ <- tracingDataStore.editableMappingsInfo.put(editableMappingId, newVersion, updatedEditableMappingInfo)
    } yield ()

  private def flushSegmentToAgglomerateChunk(key: String): Fox[Unit] = {
    val chunk = segmentToAgglomerateBuffer(key)
    val proto = SegmentToAgglomerateProto(chunk.toVector.map { segmentAgglomerateTuple =>
      SegmentAgglomeratePair(segmentAgglomerateTuple._1, segmentAgglomerateTuple._2)
    })
    tracingDataStore.editableMappingsSegmentToAgglomerate.put(key, newVersion, proto.toByteArray)
  }

  private def flushAgglomerateGraph(key: String): Fox[Unit] = {
    val graph = agglomerateToGraphBuffer(key)
    tracingDataStore.editableMappingsAgglomerateToGraph.put(key, newVersion, graph)
  }

  private def updateIter(mappingFox: Fox[EditableMappingInfo], remainingUpdates: List[EditableMappingUpdateAction])(
      implicit ec: ExecutionContext): Fox[EditableMappingInfo] =
    mappingFox.futureBox.flatMap {
      case Empty =>
        Fox.empty
      case Full(mapping) =>
        remainingUpdates match {
          case List() => Fox.successful(mapping)
          case head :: tail =>
            val nextFox: Fox[EditableMappingInfo] = applyOneUpdate(mapping, head)
            updateIter(
              nextFox,
              tail
            )
        }
      case _: Failure =>
        mappingFox
      case _ =>
        mappingFox
    }

  private def applyOneUpdate(mapping: EditableMappingInfo, update: EditableMappingUpdateAction)(
      implicit ec: ExecutionContext): Fox[EditableMappingInfo] =
    update match {
      case splitAction: SplitAgglomerateUpdateAction =>
        applySplitAction(mapping, splitAction) ?~> "Failed to apply split action"
      case mergeAction: MergeAgglomerateUpdateAction =>
        applyMergeAction(mapping, mergeAction) ?~> "Failed to apply merge action"
    }

  private def applySplitAction(editableMappingInfo: EditableMappingInfo, update: SplitAgglomerateUpdateAction)(
      implicit ec: ExecutionContext): Fox[EditableMappingInfo] =
    for {
      segmentId1 <- editableMappingService.findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                                           update.segmentPosition1,
                                                                           update.segmentId1,
                                                                           update.mag,
                                                                           userToken)
      segmentId2 <- editableMappingService.findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                                           update.segmentPosition2,
                                                                           update.segmentId2,
                                                                           update.mag,
                                                                           userToken)
      agglomerateId <- agglomerateIdForSplitAction(update, segmentId1)
      agglomerateGraph <- agglomerateGraphForIdWithFallback(editableMappingInfo, agglomerateId, None)
      _ = if (segmentId1 == 0)
        logger.warn(
          s"Split action for editable mapping $editableMappingId: Looking up segment id at position ${update.segmentPosition1} in mag ${update.mag} returned invalid value zero. Splitting outside of dataset?")
      _ = if (segmentId2 == 0)
        logger.warn(
          s"Split action for editable mapping $editableMappingId: Looking up segment id at position ${update.segmentPosition2} in mag ${update.mag} returned invalid value zero. Splitting outside of dataset?")
      (graph1, graph2) <- tryo(splitGraph(agglomerateId, agglomerateGraph, update, segmentId1, segmentId2)) ?~> s"splitGraph failed while removing edge between segments $segmentId1 and $segmentId2"
      actualSplitHappened = graph2.segments.nonEmpty
      largestExistingAgglomerateId <- largestAgglomerateId(editableMappingInfo)
      agglomerateId2 = largestExistingAgglomerateId + 1L
      _ <- Fox.runIf(actualSplitHappened)(updateSegmentToAgglomerate(graph2.segments, agglomerateId2))
      _ = if (actualSplitHappened) updateAgglomerateGraph(agglomerateId, graph1)
      _ = if (actualSplitHappened) updateAgglomerateGraph(agglomerateId2, graph2)
    } yield
      if (actualSplitHappened) editableMappingInfo.withLargestAgglomerateId(agglomerateId2) else editableMappingInfo

  private def agglomerateIdForSplitAction(updateAction: SplitAgglomerateUpdateAction, segmentId1: Long)(
      implicit ec: ExecutionContext): Fox[Long] =
    if (relyOnAgglomerateIds) {
      Fox.successful(updateAction.agglomerateId)
    } else {
      agglomerateIdForSegmentId(segmentId1)
    }

  private def agglomerateIdsForMergeAction(updateAction: MergeAgglomerateUpdateAction,
                                           segmentId1: Long,
                                           segmentId2: Long)(implicit ec: ExecutionContext): Fox[(Long, Long)] =
    if (relyOnAgglomerateIds) {
      Fox.successful((updateAction.agglomerateId1, updateAction.agglomerateId2))
    } else {
      for {
        agglomerateId1 <- agglomerateIdForSegmentId(segmentId1)
        agglomerateId2 <- agglomerateIdForSegmentId(segmentId2)
      } yield (agglomerateId1, agglomerateId2)
    }

  private def agglomerateIdForSegmentId(segmentId: Long)(implicit ec: ExecutionContext): Fox[Long] = {
    val chunkId = segmentId / editableMappingService.defaultSegmentToAgglomerateChunkSize
    val chunkKey = editableMappingService.segmentToAgglomerateKey(editableMappingId, chunkId)
    val chunkFromBufferOpt = segmentToAgglomerateBuffer.get(chunkKey)
    for {
      chunk <- Fox.fillOption(chunkFromBufferOpt) {
        editableMappingService
          .getSegmentToAgglomerateChunkWithEmptyFallback(editableMappingId, chunkId, version = oldVersion)
          .map(_.toMap)
      }
      agglomerateId <- chunk.get(segmentId) match {
        case Some(agglomerateId) => Fox.successful(agglomerateId)
        case None =>
          editableMappingService
            .getBaseSegmentToAgglomerate(baseMappingName, Set(segmentId), remoteFallbackLayer, userToken)
            .flatMap(baseSegmentToAgglomerate => baseSegmentToAgglomerate.get(segmentId))
      }
    } yield agglomerateId
  }

  private def updateSegmentToAgglomerate(segmentIdsToUpdate: Seq[Long], agglomerateId: Long)(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      chunkedSegmentIds: Map[Long, Seq[Long]] <- Fox.successful(
        segmentIdsToUpdate.groupBy(_ / editableMappingService.defaultSegmentToAgglomerateChunkSize))
      _ <- Fox.serialCombined(chunkedSegmentIds.keys.toList) { chunkId =>
        updateSegmentToAgglomerateChunk(agglomerateId, chunkId, chunkedSegmentIds(chunkId))
      }
    } yield ()

  private def updateSegmentToAgglomerateChunk(agglomerateId: Long, chunkId: Long, segmentIdsToUpdate: Seq[Long])(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      existingChunk: Map[Long, Long] <- getSegmentToAgglomerateChunkWithEmptyFallback(editableMappingId, chunkId) ?~> "failed to get old segment to agglomerate chunk for updating it"
      mergedMap = existingChunk ++ segmentIdsToUpdate.map(_ -> agglomerateId).toMap
      _ = segmentToAgglomerateBuffer.put(editableMappingService.segmentToAgglomerateKey(editableMappingId, chunkId),
                                         mergedMap)
    } yield ()

  private def getSegmentToAgglomerateChunkWithEmptyFallback(editableMappingId: String, chunkId: Long)(
      implicit ec: ExecutionContext): Fox[Map[Long, Long]] = {
    val key = editableMappingService.segmentToAgglomerateKey(editableMappingId, chunkId)
    val fromBufferOpt = segmentToAgglomerateBuffer.get(key)
    Fox.fillOption(fromBufferOpt) {
      editableMappingService
        .getSegmentToAgglomerateChunkWithEmptyFallback(editableMappingId, chunkId, version = oldVersion)
        .map(_.toMap)
    }
  }

  private def agglomerateGraphForIdWithFallback(
      mapping: EditableMappingInfo,
      agglomerateId: Long,
      segmentPosition: Option[Vec3Int])(implicit ec: ExecutionContext): Fox[AgglomerateGraph] = {
    val key = editableMappingService.agglomerateGraphKey(editableMappingId, agglomerateId)
    val fromBufferOpt = agglomerateToGraphBuffer.get(key)
    fromBufferOpt.map(Fox.successful(_)).getOrElse {
      editableMappingService.getAgglomerateGraphForIdWithFallback(mapping,
                                                                  editableMappingId,
                                                                  Some(oldVersion),
                                                                  agglomerateId,
                                                                  segmentPosition,
                                                                  remoteFallbackLayer,
                                                                  userToken)
    }
  }

  private def updateAgglomerateGraph(agglomerateId: Long, graph: AgglomerateGraph): Unit = {
    val key = editableMappingService.agglomerateGraphKey(editableMappingId, agglomerateId)
    agglomerateToGraphBuffer.put(key, graph)
  }

  private def splitGraph(agglomerateId: Long,
                         agglomerateGraph: AgglomerateGraph,
                         update: SplitAgglomerateUpdateAction,
                         segmentId1: Long,
                         segmentId2: Long): (AgglomerateGraph, AgglomerateGraph) = {
    val edgesAndAffinitiesMinusOne: Seq[(AgglomerateEdge, Float)] =
      agglomerateGraph.edges.zip(agglomerateGraph.affinities).filterNot {
        case (AgglomerateEdge(from, to, _), _) =>
          (from == segmentId1 && to == segmentId2) || (from == segmentId2 && to == segmentId1)
      }
    if (edgesAndAffinitiesMinusOne.length == agglomerateGraph.edges.length) {
      if (relyOnAgglomerateIds) {
        logger.warn(
          s"Split action for editable mapping $editableMappingId: Edge to remove ($segmentId1 at ${update.segmentPosition1} in mag ${update.mag} to $segmentId2 at ${update.segmentPosition2} in mag ${update.mag} in agglomerate $agglomerateId) already absent. This split becomes a no-op.")
      }
      (agglomerateGraph, AgglomerateGraph(Seq(), Seq(), Seq(), Seq()))
    } else {
      val graph1Nodes: Set[Long] =
        computeConnectedComponent(startNode = segmentId1,
                                  agglomerateGraph.segments,
                                  edgesAndAffinitiesMinusOne.map(_._1))
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
  }

  private def computeConnectedComponent(startNode: Long, nodes: Seq[Long], edges: Seq[AgglomerateEdge]): Set[Long] =
    if (edges.length < 30) {
      // For small graphs, use scala implementation, as the conversion overhead would dominate.
      // For large graphs, the faster computation of jgraphT outweighs it.
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
    } else {
      val g = new DefaultUndirectedGraph[Long, DefaultEdge](classOf[DefaultEdge])
      nodes.foreach(g.addVertex)
      edges.foreach { e =>
        g.addEdge(e.source, e.target)
      }
      new ConnectivityInspector(g).connectedSetOf(startNode).asScala.toSet
    }

  private def largestAgglomerateId(mapping: EditableMappingInfo): Fox[Long] =
    for {
      largestBaseAgglomerateId <- remoteDatastoreClient.getLargestAgglomerateId(remoteFallbackLayer,
                                                                                mapping.baseMappingName,
                                                                                userToken)
    } yield math.max(mapping.largestAgglomerateId, largestBaseAgglomerateId)

  private def applyMergeAction(mapping: EditableMappingInfo, update: MergeAgglomerateUpdateAction)(
      implicit ec: ExecutionContext): Fox[EditableMappingInfo] =
    for {
      segmentId1 <- editableMappingService.findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                                           update.segmentPosition1,
                                                                           update.segmentId1,
                                                                           update.mag,
                                                                           userToken)
      segmentId2 <- editableMappingService.findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                                           update.segmentPosition2,
                                                                           update.segmentId2,
                                                                           update.mag,
                                                                           userToken)
      _ = if (segmentId1 == 0)
        logger.warn(
          s"Merge action for editable mapping $editableMappingId: Looking up segment id at position ${update.segmentPosition1} in mag ${update.mag} returned invalid value zero. Merging outside of dataset?")
      _ = if (segmentId2 == 0)
        logger.warn(
          s"Merge action for editable mapping $editableMappingId: Looking up segment id at position ${update.segmentPosition2} in mag ${update.mag} returned invalid value zero. Merging outside of dataset?")
      (agglomerateId1, agglomerateId2) <- agglomerateIdsForMergeAction(update, segmentId1, segmentId2) ?~> "Failed to look up agglomerate ids for merge action segments"
      agglomerateGraph1 <- agglomerateGraphForIdWithFallback(mapping, agglomerateId1, update.segmentPosition1) ?~> s"Failed to get agglomerate graph for id $agglomerateId1"
      agglomerateGraph2 <- agglomerateGraphForIdWithFallback(mapping, agglomerateId2, update.segmentPosition2) ?~> s"Failed to get agglomerate graph for id $agglomerateId2"
      _ <- bool2Fox(agglomerateGraph2.segments.contains(segmentId2)) ?~> s"Segment $segmentId2 as queried by position ${update.segmentPosition2} is not contained in fetched agglomerate graph for agglomerate $agglomerateId2"
      mergedGraphOpt = mergeGraph(agglomerateGraph1,
                                  agglomerateGraph2,
                                  update,
                                  agglomerateId1,
                                  agglomerateId2,
                                  segmentId1,
                                  segmentId2)
      _ <- Fox.runOptional(mergedGraphOpt) { mergedGraph =>
        for {
          _ <- updateSegmentToAgglomerate(agglomerateGraph2.segments, agglomerateId1) ?~> s"Failed to update segment to agglomerate buffer"
          _ = updateAgglomerateGraph(agglomerateId1, mergedGraph)
          _ = updateAgglomerateGraph(agglomerateId2, AgglomerateGraph(List.empty, List.empty, List.empty, List.empty))
        } yield ()
      }
    } yield mapping

  private def mergeGraph(agglomerateGraph1: AgglomerateGraph,
                         agglomerateGraph2: AgglomerateGraph,
                         update: MergeAgglomerateUpdateAction,
                         agglomerateId1: Long,
                         agglomerateId2: Long,
                         segmentId1: Long,
                         segmentId2: Long): Option[AgglomerateGraph] = {
    val segment1IsValid = agglomerateGraph1.segments.contains(segmentId1)
    val segment2IsValid = agglomerateGraph2.segments.contains(segmentId2)
    warnOnInvalidSegmentToMerge(segment1IsValid, segmentId1, update.segmentPosition1, update.mag, agglomerateId1)
    warnOnInvalidSegmentToMerge(segment2IsValid, segmentId2, update.segmentPosition2, update.mag, agglomerateId2)
    if (segment1IsValid && segment2IsValid) {
      val newEdge = AgglomerateEdge(segmentId1, segmentId2)
      val newEdgeAffinity = 255.0f
      Some(
        AgglomerateGraph(
          segments = agglomerateGraph1.segments ++ agglomerateGraph2.segments,
          edges = newEdge +: (agglomerateGraph1.edges ++ agglomerateGraph2.edges),
          affinities = newEdgeAffinity +: (agglomerateGraph1.affinities ++ agglomerateGraph2.affinities),
          positions = agglomerateGraph1.positions ++ agglomerateGraph2.positions
        ))
    } else None
  }

  private def warnOnInvalidSegmentToMerge(isValid: Boolean,
                                          segmentId: Long,
                                          position: Option[Vec3Int],
                                          mag: Vec3Int,
                                          agglomerateId: Long): Unit =
    if (!isValid && relyOnAgglomerateIds) {
      logger.warn(
        s"Merge action for editable mapping $editableMappingId: segment $segmentId as looked up at $position in mag $mag is not present in agglomerate $agglomerateId. This merge becomes a no-op"
      )
    }

}
