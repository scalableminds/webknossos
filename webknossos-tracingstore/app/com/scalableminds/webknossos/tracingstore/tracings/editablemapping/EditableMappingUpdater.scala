package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.EditableMappingInfo.EditableMappingInfo
import com.scalableminds.webknossos.datastore.SegmentToAgglomerateProto.{
  SegmentAgglomeratePair,
  SegmentToAgglomerateChunkProto
}
import com.scalableminds.webknossos.tracingstore.TSRemoteDatastoreClient
import com.scalableminds.webknossos.tracingstore.annotation.UpdateAction
import com.scalableminds.webknossos.tracingstore.tracings.volume.ReversionHelper
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
    annotationId: String,
    tracingId: String,
    baseMappingName: String,
    oldVersion: Long,
    newVersion: Long,
    remoteFallbackLayer: RemoteFallbackLayer,
    tokenContext: TokenContext,
    remoteDatastoreClient: TSRemoteDatastoreClient,
    editableMappingService: EditableMappingService,
    tracingDataStore: TracingDataStore
) extends KeyValueStoreImplicits
    with ReversionHelper
    with FoxImplicits
    with EditableMappingElementKeys
    with LazyLogging {

  // chunkKey → (Map[segmentId → agglomerateId], isToBeReverted)
  private val segmentToAgglomerateBuffer: mutable.Map[String, (Map[Long, Long], Boolean)] =
    new mutable.HashMap[String, (Map[Long, Long], Boolean)]()
  // agglomerateKey → (agglomerateGraph, isToBeReverted)
  private val agglomerateToGraphBuffer: mutable.Map[String, (AgglomerateGraph, Boolean)] =
    new mutable.HashMap[String, (AgglomerateGraph, Boolean)]()

  def applyUpdatesAndSave(existingEditabeMappingInfo: EditableMappingInfo,
                          updates: List[UpdateAction],
                          dry: Boolean = false)(implicit ec: ExecutionContext): Fox[EditableMappingInfo] =
    for {
      updatedEditableMappingInfo: EditableMappingInfo <- updateIter(Some(existingEditabeMappingInfo), updates)
      _ <- Fox.runIf(!dry)(flushBuffersToFossil())
      _ <- Fox.runIf(!dry)(flushUpdatedInfoToFossil(updatedEditableMappingInfo))
    } yield updatedEditableMappingInfo

  def flushBuffersToFossil()(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(segmentToAgglomerateBuffer.keys.toList)(flushSegmentToAgglomerateChunk)
      _ <- Fox.serialCombined(agglomerateToGraphBuffer.keys.toList)(flushAgglomerateGraph)
    } yield ()

  private def flushUpdatedInfoToFossil(updatedEditableMappingInfo: EditableMappingInfo): Fox[Unit] =
    for {
      _ <- tracingDataStore.editableMappingsInfo.put(tracingId, newVersion, updatedEditableMappingInfo)
    } yield ()

  private def flushSegmentToAgglomerateChunk(key: String): Fox[Unit] = {
    val (chunk, isToBeReverted) = segmentToAgglomerateBuffer(key)
    val valueToFlush: Array[Byte] =
      if (isToBeReverted) revertedValue
      else {
        val proto = SegmentToAgglomerateChunkProto(chunk.toVector.map { segmentAgglomerateTuple =>
          SegmentAgglomeratePair(segmentAgglomerateTuple._1, segmentAgglomerateTuple._2)
        })
        proto.toByteArray
      }
    tracingDataStore.editableMappingsSegmentToAgglomerate.put(key, newVersion, valueToFlush)
  }

  private def flushAgglomerateGraph(key: String): Fox[Unit] = {
    val (graph, isToBeReverted) = agglomerateToGraphBuffer(key)
    val valueToFlush: Array[Byte] = if (isToBeReverted) revertedValue else graph
    tracingDataStore.editableMappingsAgglomerateToGraph.put(key, newVersion, valueToFlush)
  }

  private def updateIter(mappingFox: Fox[EditableMappingInfo], remainingUpdates: List[UpdateAction])(
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

  def applyOneUpdate(mapping: EditableMappingInfo, update: UpdateAction)(
      implicit ec: ExecutionContext): Fox[EditableMappingInfo] =
    update match {
      case splitAction: SplitAgglomerateUpdateAction =>
        applySplitAction(mapping, splitAction) ?~> "Failed to apply split action"
      case mergeAction: MergeAgglomerateUpdateAction =>
        applyMergeAction(mapping, mergeAction) ?~> "Failed to apply merge action"
      case _ => Fox.failure("this is not an editable mapping update action!")
    }

  private def applySplitAction(editableMappingInfo: EditableMappingInfo, update: SplitAgglomerateUpdateAction)(
      implicit ec: ExecutionContext): Fox[EditableMappingInfo] =
    for {
      segmentId1 <- editableMappingService.findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                                           update.segmentPosition1,
                                                                           update.segmentId1,
                                                                           update.mag)(tokenContext)
      segmentId2 <- editableMappingService.findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                                           update.segmentPosition2,
                                                                           update.segmentId2,
                                                                           update.mag)(tokenContext)
      agglomerateId <- agglomerateIdForSegmentId(segmentId1)
      agglomerateGraph <- agglomerateGraphForIdWithFallback(editableMappingInfo, agglomerateId)
      _ = if (segmentId1 == 0)
        logger.warn(
          s"Split action for editable mapping $tracingId: Looking up segment id at position ${update.segmentPosition1} in mag ${update.mag} returned invalid value zero. Splitting outside of dataset?")
      _ = if (segmentId2 == 0)
        logger.warn(
          s"Split action for editable mapping $tracingId: Looking up segment id at position ${update.segmentPosition2} in mag ${update.mag} returned invalid value zero. Splitting outside of dataset?")
      (graph1, graph2) <- tryo(splitGraph(agglomerateGraph, segmentId1, segmentId2)) ?~> s"splitGraph failed while removing edge between segments $segmentId1 and $segmentId2"
      largestExistingAgglomerateId <- largestAgglomerateId(editableMappingInfo)
      agglomerateId2 = largestExistingAgglomerateId + 1L
      _ <- updateSegmentToAgglomerate(graph2.segments, agglomerateId2)
      _ = updateAgglomerateGraph(agglomerateId, graph1)
      _ = updateAgglomerateGraph(agglomerateId2, graph2)
    } yield editableMappingInfo.withLargestAgglomerateId(agglomerateId2)

  private def getFromSegmentToAgglomerateBuffer(chunkKey: String): Option[Map[Long, Long]] =
    segmentToAgglomerateBuffer.get(chunkKey).flatMap {
      case (chunkFromBuffer, isToBeReverted) =>
        if (isToBeReverted) None else Some(chunkFromBuffer)
    }

  private def getFromAgglomerateToGraphBuffer(chunkKey: String): Option[AgglomerateGraph] =
    agglomerateToGraphBuffer.get(chunkKey).flatMap {
      case (graphFromBuffer, isToBeReverted) =>
        if (isToBeReverted) None else Some(graphFromBuffer)
    }

  private def agglomerateIdForSegmentId(segmentId: Long)(implicit ec: ExecutionContext): Fox[Long] = {
    val chunkId = segmentId / editableMappingService.defaultSegmentToAgglomerateChunkSize
    val chunkKey = segmentToAgglomerateKey(tracingId, chunkId)
    val chunkFromBufferOpt = getFromSegmentToAgglomerateBuffer(chunkKey)
    for {
      chunk <- Fox.fillOption(chunkFromBufferOpt) {
        editableMappingService
          .getSegmentToAgglomerateChunkWithEmptyFallback(tracingId, chunkId, version = oldVersion)
          .map(_.toMap)
      }
      agglomerateId <- chunk.get(segmentId) match {
        case Some(agglomerateId) => Fox.successful(agglomerateId)
        case None =>
          editableMappingService
            .getBaseSegmentToAgglomerate(baseMappingName, Set(segmentId), remoteFallbackLayer)(tokenContext)
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
      existingChunk: Map[Long, Long] <- getSegmentToAgglomerateChunkWithEmptyFallback(tracingId, chunkId) ?~> "failed to get old segment to agglomerate chunk for updating it"
      mergedMap = existingChunk ++ segmentIdsToUpdate.map(_ -> agglomerateId).toMap
      _ = segmentToAgglomerateBuffer.put(segmentToAgglomerateKey(tracingId, chunkId), (mergedMap, false))
    } yield ()

  private def getSegmentToAgglomerateChunkWithEmptyFallback(tracingId: String, chunkId: Long)(
      implicit ec: ExecutionContext): Fox[Map[Long, Long]] = {
    val key = segmentToAgglomerateKey(tracingId, chunkId)
    val fromBufferOpt = getFromSegmentToAgglomerateBuffer(key)
    Fox.fillOption(fromBufferOpt) {
      editableMappingService
        .getSegmentToAgglomerateChunkWithEmptyFallback(tracingId, chunkId, version = oldVersion)
        .map(_.toMap)
    }
  }

  private def agglomerateGraphForIdWithFallback(mapping: EditableMappingInfo, agglomerateId: Long)(
      implicit ec: ExecutionContext): Fox[AgglomerateGraph] = {
    val key = agglomerateGraphKey(tracingId, agglomerateId)
    val fromBufferOpt = getFromAgglomerateToGraphBuffer(key)
    fromBufferOpt.map(Fox.successful(_)).getOrElse {
      editableMappingService.getAgglomerateGraphForIdWithFallback(mapping,
                                                                  tracingId,
                                                                  oldVersion,
                                                                  agglomerateId,
                                                                  remoteFallbackLayer)(tokenContext)
    }
  }

  private def updateAgglomerateGraph(agglomerateId: Long, graph: AgglomerateGraph): Unit = {
    val key = agglomerateGraphKey(tracingId, agglomerateId)
    agglomerateToGraphBuffer.put(key, (graph, false))
  }

  private def emptyAgglomerateGraph = AgglomerateGraph(Seq(), Seq(), Seq(), Seq())

  private def splitGraph(agglomerateGraph: AgglomerateGraph,
                         segmentId1: Long,
                         segmentId2: Long): (AgglomerateGraph, AgglomerateGraph) = {
    val edgesAndAffinitiesMinusOne: Seq[(AgglomerateEdge, Float)] =
      agglomerateGraph.edges.zip(agglomerateGraph.affinities).filterNot {
        case (AgglomerateEdge(from, to, _), _) =>
          (from == segmentId1 && to == segmentId2) || (from == segmentId2 && to == segmentId1)
      }
    if (edgesAndAffinitiesMinusOne.length == agglomerateGraph.edges.length) {
      (agglomerateGraph, emptyAgglomerateGraph)
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
                                                                                mapping.baseMappingName)(tokenContext)
    } yield math.max(mapping.largestAgglomerateId, largestBaseAgglomerateId)

  private def applyMergeAction(mapping: EditableMappingInfo, update: MergeAgglomerateUpdateAction)(
      implicit ec: ExecutionContext): Fox[EditableMappingInfo] =
    for {
      segmentId1 <- editableMappingService.findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                                           update.segmentPosition1,
                                                                           update.segmentId1,
                                                                           update.mag)(tokenContext)
      segmentId2 <- editableMappingService.findSegmentIdAtPositionIfNeeded(remoteFallbackLayer,
                                                                           update.segmentPosition2,
                                                                           update.segmentId2,
                                                                           update.mag)(tokenContext)
      _ = if (segmentId1 == 0)
        logger.warn(
          s"Merge action for editable mapping $tracingId: Looking up segment id at position ${update.segmentPosition1} in mag ${update.mag} returned invalid value zero. Merging outside of dataset?")
      _ = if (segmentId2 == 0)
        logger.warn(
          s"Merge action for editable mapping $tracingId: Looking up segment id at position ${update.segmentPosition2} in mag ${update.mag} returned invalid value zero. Merging outside of dataset?")
      agglomerateId1 <- agglomerateIdForSegmentId(segmentId1) ?~> "Failed to look up agglomerate ids for merge action segments"
      agglomerateId2 <- agglomerateIdForSegmentId(segmentId2) ?~> "Failed to look up agglomerate ids for merge action segments"
      agglomerateGraph1 <- agglomerateGraphForIdWithFallback(mapping, agglomerateId1) ?~> s"Failed to get agglomerate graph for id $agglomerateId1"
      agglomerateGraph2 <- agglomerateGraphForIdWithFallback(mapping, agglomerateId2) ?~> s"Failed to get agglomerate graph for id $agglomerateId2"
      _ <- bool2Fox(agglomerateGraph2.segments.contains(segmentId2)) ?~> s"Segment $segmentId2 as queried by position ${update.segmentPosition2} is not contained in fetched agglomerate graph for agglomerate $agglomerateId2. actionTimestamp: ${update.actionTimestamp}, graph segments: ${agglomerateGraph2.segments}"
      mergedGraphOpt = mergeGraph(agglomerateGraph1, agglomerateGraph2, segmentId1, segmentId2)
      _ <- Fox.runOptional(mergedGraphOpt) { mergedGraph =>
        for {
          _ <- updateSegmentToAgglomerate(agglomerateGraph2.segments, agglomerateId1) ?~> s"Failed to update segment to agglomerate buffer"
          _ = updateAgglomerateGraph(agglomerateId1, mergedGraph)
          _ = if (agglomerateId1 != agglomerateId2)
            // The second agglomerate vanishes, as all its segments have been moved to agglomerateId1
            updateAgglomerateGraph(agglomerateId2, AgglomerateGraph(List.empty, List.empty, List.empty, List.empty))
        } yield ()
      }
    } yield mapping

  private def mergeGraph(agglomerateGraph1: AgglomerateGraph,
                         agglomerateGraph2: AgglomerateGraph,
                         segmentId1: Long,
                         segmentId2: Long): Option[AgglomerateGraph] = {
    val newEdgeAffinity = 255.0f
    val newEdge = AgglomerateEdge(segmentId1, segmentId2)
    if (agglomerateGraph1 == agglomerateGraph2) {
      // Agglomerate is merged with itself. Insert new edge anyway, if it does not exist yet
      if (agglomerateGraph1.edges.contains(newEdge)) {
        Some(agglomerateGraph1)
      } else {
        Some(
          agglomerateGraph1.copy(edges = newEdge +: agglomerateGraph1.edges,
                                 affinities = newEdgeAffinity +: agglomerateGraph1.affinities))
      }
    } else {
      val segment1IsValid = agglomerateGraph1.segments.contains(segmentId1)
      val segment2IsValid = agglomerateGraph2.segments.contains(segmentId2)
      if (segment1IsValid && segment2IsValid) {
        Some(
          AgglomerateGraph(
            segments = agglomerateGraph1.segments ++ agglomerateGraph2.segments,
            edges = newEdge +: (agglomerateGraph1.edges ++ agglomerateGraph2.edges),
            affinities = newEdgeAffinity +: (agglomerateGraph1.affinities ++ agglomerateGraph2.affinities),
            positions = agglomerateGraph1.positions ++ agglomerateGraph2.positions
          ))
      } else None
    }
  }

  def revertToVersion(sourceVersion: Long)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- bool2Fox(sourceVersion <= oldVersion) ?~> "trying to revert editable mapping to a version not yet present in the database"
      _ = segmentToAgglomerateBuffer.clear()
      _ = agglomerateToGraphBuffer.clear()
      segmentToAgglomerateChunkNewestStream = new VersionedSegmentToAgglomerateChunkIterator(
        tracingId,
        tracingDataStore.editableMappingsSegmentToAgglomerate)
      _ <- Fox.serialCombined(segmentToAgglomerateChunkNewestStream) {
        case (chunkKey, _, version) =>
          if (version > sourceVersion) {
            editableMappingService.getSegmentToAgglomerateChunk(chunkKey, Some(sourceVersion)).futureBox.map {
              case Full(chunkData) => segmentToAgglomerateBuffer.put(chunkKey, (chunkData.toMap, false))
              case Empty           => segmentToAgglomerateBuffer.put(chunkKey, (Map[Long, Long](), true))
              case Failure(msg, _, chain) =>
                Fox.failure(msg, Empty, chain)
            }
          } else Fox.successful(())
      }
      agglomerateToGraphNewestStream = new VersionedAgglomerateToGraphIterator(
        tracingId,
        tracingDataStore.editableMappingsAgglomerateToGraph)
      _ <- Fox.serialCombined(agglomerateToGraphNewestStream) {
        case (graphKey, _, version) =>
          if (version > sourceVersion) {
            for {
              agglomerateId <- agglomerateIdFromAgglomerateGraphKey(graphKey)
              _ <- editableMappingService
                .getAgglomerateGraphForId(tracingId, sourceVersion, agglomerateId)
                .futureBox
                .map {
                  case Full(graphData) => agglomerateToGraphBuffer.put(graphKey, (graphData, false))
                  case Empty           => agglomerateToGraphBuffer.put(graphKey, (emptyAgglomerateGraph, true))
                  case Failure(msg, _, chain) =>
                    Fox.failure(msg, Empty, chain)
                }
            } yield ()
          } else Fox.successful(())
      }
    } yield ()

  def newWithTargetVersion(currentMaterializedVersion: Long, targetVersion: Long): EditableMappingUpdater =
    new EditableMappingUpdater(
      annotationId,
      tracingId,
      baseMappingName,
      currentMaterializedVersion,
      targetVersion,
      remoteFallbackLayer,
      tokenContext,
      remoteDatastoreClient,
      editableMappingService,
      tracingDataStore
    )
}
