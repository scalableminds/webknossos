package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.EditableMapping.EditableMappingProto
import com.scalableminds.webknossos.datastore.SegmentToAgglomerateProto.{
  SegmentAgglomeratePair,
  SegmentToAgglomerateProto
}
import com.scalableminds.webknossos.tracingstore.TSRemoteDatastoreClient
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Full}

import scala.collection.mutable
import scala.concurrent.ExecutionContext

class EditableMappingUpdater(editableMappingId: String,
                             newVersion: Long,
                             remoteFallbackLayer: RemoteFallbackLayer,
                             userToken: Option[String],
                             remoteDatastoreClient: TSRemoteDatastoreClient,
                             editableMappingService: EditableMappingService)
    extends LazyLogging {

  val segmentToAgglomerateBuffer: mutable.Map[String, Seq[(Long, Long)]] =
    new mutable.HashMap[String, Seq[(Long, Long)]]()
  val agglomerateToGraphBuffer: mutable.Map[String, AgglomerateGraph] =
    new mutable.HashMap[String, AgglomerateGraph]()

  def applyUpdates(existingEditabeMappingInfo: EditableMappingProto, updates: List[EditableMappingUpdateAction])(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      updatedEditableMappingInfo <- updateIter(Some(existingEditabeMappingInfo), updates, newVersion)
      _ <- flush()
    } yield ()

  private def flush()(implicit ec: ExecutionContext): Fox[Unit] = Fox.successful(()) // TODO

  private def updateIter(mappingFox: Fox[EditableMappingProto],
                         remainingUpdates: List[EditableMappingUpdateAction],
                         nextVersion: Long)(implicit ec: ExecutionContext): Fox[EditableMappingProto] = {
    logger.info(s"Applying ${remainingUpdates.length} updates...")
    mappingFox.futureBox.flatMap {
      case Empty => Fox.empty
      case Full(mapping) =>
        remainingUpdates match {
          case List() => Fox.successful(mapping)
          case head :: updatesTail =>
            updateIter(
              applyOneUpdate(mapping, editableMappingId, nextVersion: Long, head),
              updatesTail,
              nextVersion + 1L
            )
        }
      case _ => mappingFox
    }
  }

  private def applyOneUpdate(mapping: EditableMappingProto, nextVersion: Long, update: EditableMappingUpdateAction)(
      implicit ec: ExecutionContext): Fox[EditableMappingProto] =
    update match {
      case splitAction: SplitAgglomerateUpdateAction =>
        applySplitAction(mapping, nextVersion, splitAction)
      case mergeAction: MergeAgglomerateUpdateAction =>
        applyMergeAction(mapping, nextVersion, mergeAction)
    }

  private def applySplitAction(
      editableMappingInfo: EditableMappingProto,
      nextVersion: Long,
      update: SplitAgglomerateUpdateAction)(implicit ec: ExecutionContext): Fox[EditableMappingProto] =
    for {
      _ <- Fox.successful(logger.info("APPLY SPLIT"))
      agglomerateGraph <- agglomerateGraphForIdWithFallback(editableMappingInfo,
                                                            Some(nextVersion - 1L),
                                                            update.agglomerateId)
      segmentId1 <- editableMappingService.findSegmentIdAtPosition(remoteFallbackLayer,
                                                                   update.segmentPosition1,
                                                                   update.mag,
                                                                   userToken)
      segmentId2 <- editableMappingService.findSegmentIdAtPosition(remoteFallbackLayer,
                                                                   update.segmentPosition2,
                                                                   update.mag,
                                                                   userToken)
      largestExistingAgglomerateId <- largestAgglomerateId(editableMappingInfo)
      agglomerateId2 = largestExistingAgglomerateId + 1L
      (graph1, graph2) = splitGraph(agglomerateGraph, segmentId1, segmentId2)
      _ <- updateSegmentToAgglomerate(editableMappingId, nextVersion, graph2.segments, agglomerateId2)
      _ <- updateAgglomerateGraph(editableMappingId, nextVersion, update.agglomerateId, graph1)
      _ <- updateAgglomerateGraph(editableMappingId, nextVersion, agglomerateId2, graph2)
    } yield editableMappingInfo.withLargestAgglomerateId(agglomerateId2)

  private def updateSegmentToAgglomerate(mappingId: String,
                                         newVersion: Long,
                                         segmentIdsToUpdate: Seq[Long],
                                         agglomerateId: Long)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      chunkedSegmentIds: Map[Long, Seq[Long]] <- Fox.successful(
        segmentIdsToUpdate.groupBy(_ / editableMappingService.defaultSegmentToAgglomerateChunkSize))
      _ <- Fox.serialCombined(chunkedSegmentIds.keys.toList) { chunkId =>
        updateSegmentToAgglomerateChunk(mappingId, newVersion, agglomerateId, chunkId, chunkedSegmentIds(chunkId))
      }
    } yield ()

  private def updateSegmentToAgglomerateChunk(editableMappingId: String,
                                              newVersion: Long,
                                              agglomerateId: Long,
                                              chunkId: Long,
                                              segmentIdsToUpdate: Seq[Long])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.successful(logger.info(s"UPDATE segment to agglomerate chunk, chunk id $chunkId"))
      existingChunk: Seq[(Long, Long)] <- getSegmentToAgglomerateChunkWithEmptyFallback(editableMappingId, chunkId)
      chunkMap = existingChunk.toMap
      mergedMap = chunkMap ++ segmentIdsToUpdate.map(_ -> agglomerateId).toMap
      proto = SegmentToAgglomerateProto(mergedMap.toVector.map { segmentAgglomerateTuple =>
        SegmentAgglomeratePair(segmentAgglomerateTuple._1, segmentAgglomerateTuple._2)
      })
      _ <- tracingDataStore.editableMappingsSegmentToAgglomerate.put(
        editableMappingService.segmentToAgglomerateKey(editableMappingId, chunkId),
        newVersion,
        proto.toByteArray)
    } yield ()

  private def updateAgglomerateGraph(mappingId: String,
                                     newVersion: Long,
                                     agglomerateId: Long,
                                     graph: AgglomerateGraph): Fox[Unit] = {
    logger.info(s"update agglomerate graph $agglomerateId with ${graph.edges.length} edges")
    tracingDataStore.editableMappingsAgglomerateToGraph.put(
      editableMappingService.agglomerateGraphKey(mappingId, agglomerateId),
      newVersion,
      graph)
  }

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

  private def largestAgglomerateId(mapping: EditableMappingProto): Fox[Long] =
    for {
      largestBaseAgglomerateId <- remoteDatastoreClient.getLargestAgglomerateId(remoteFallbackLayer,
                                                                                mapping.baseMappingName,
                                                                                userToken)
    } yield math.max(mapping.largestAgglomerateId, largestBaseAgglomerateId)

  private def applyMergeAction(mapping: EditableMappingProto, newVersion: Long, update: MergeAgglomerateUpdateAction)(
      implicit ec: ExecutionContext): Fox[EditableMappingProto] =
    for {
      segmentId1 <- editableMappingService.findSegmentIdAtPosition(remoteFallbackLayer,
                                                                   update.segmentPosition1,
                                                                   update.mag,
                                                                   userToken)
      segmentId2 <- editableMappingService.findSegmentIdAtPosition(remoteFallbackLayer,
                                                                   update.segmentPosition2,
                                                                   update.mag,
                                                                   userToken)
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

}
