package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.MetadataEntry.MetadataEntryProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, SkeletonTracing, Tree, TreeTypeProto}
import com.scalableminds.webknossos.datastore.geometry.{ColorProto, Vec3IntProto}
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, SkeletonTracingDefaults}

/*
 * Compares the graph of one agglomerate with the graph of one agglomerate of a reference agglomerate view
 * (the reference agglomerate):
 * - Added edges are all edges of the agglomerate that are not part of the reference graph. For a merge, this
 *   includes the merged-in parts (everything outside of the reference agglomerate).
 * - Removed edges are reference edges with at least one endpoint in the agglomerate that are not part of the
 *   agglomerate graph. For a split, the other endpoint lies outside of the agglomerate, so the edges are dangling
 *   and lead to the first segment outside of the agglomerate. The split-off parts are not included, as these might
 *   be huge.
 */
object AgglomerateGraphDiff {

  val addedEdgesTreeName = "added edges"
  val removedEdgesTreeName = "removed edges"
  val referenceAgglomerateIdMetadataKey = "referenceAgglomerateId"

  // Pure green and orange are the two colors which are perceptually farthest away from the
  // palette that webknossos uses for tree colors (e.g., of the agglomerate skeletons).
  private val addedEdgesColor = ColorProto(0.0, 1.0, 0.0, 1.0)
  private val removedEdgesColor = ColorProto(1.0, 136.0 / 255, 0.0, 1.0)

  // Edges are undirected, so (a, b) and (b, a) map to the same key
  private def edgeKey(edge: AgglomerateEdge): (Long, Long) =
    if (edge.source <= edge.target) (edge.source, edge.target) else (edge.target, edge.source)

  def diffAsSkeleton(
      graph: AgglomerateGraph,
      referenceGraph: AgglomerateGraph,
      referenceAgglomerateId: Long
  ): SkeletonTracing = {
    // The reference agglomerate might be a huge merger, so only lookup structures for the (smaller) part that
    // touches the agglomerate are built. The reference graph itself is only iterated over.
    val segmentIds = graph.segments.toSet
    val edgeKeys = graph.edges.map(edgeKey).toSet
    val referenceEdgesTouchingAgglomerate =
      referenceGraph.edges.filter(edge => segmentIds.contains(edge.source) || segmentIds.contains(edge.target))
    val referenceEdgeKeysTouchingAgglomerate = referenceEdgesTouchingAgglomerate.map(edgeKey).toSet

    // An edge of the agglomerate can only be part of the reference graph if it is one of the reference edges
    // that touch the agglomerate.
    val addedEdges = graph.edges
      .filterNot(edge => referenceEdgeKeysTouchingAgglomerate.contains(edgeKey(edge)))
      .distinctBy(edgeKey)
    val removedEdges = referenceEdgesTouchingAgglomerate
      .filterNot(edge => edgeKeys.contains(edgeKey(edge)))
      .distinctBy(edgeKey)

    // Positions are only needed for the segments that become nodes. Positions from the agglomerate graph take
    // precedence, reference positions are only used for the dangling ends of removed edges.
    val nodeSegmentIds = (addedEdges ++ removedEdges).flatMap(edge => Seq(edge.source, edge.target)).toSet
    def positionsOfNodeSegments(sourceGraph: AgglomerateGraph): Map[Long, Vec3IntProto] =
      sourceGraph.segments.iterator.zip(sourceGraph.positions.iterator).filter { case (segmentId, _) =>
        nodeSegmentIds.contains(segmentId)
      }.toMap
    val positionsBySegmentId = positionsOfNodeSegments(referenceGraph) ++ positionsOfNodeSegments(graph)

    val now = System.currentTimeMillis()
    // webknossos expects trees to be connected, so every connected component becomes a tree of its own
    val addedEdgesTrees = connectedComponents(addedEdges).map(component =>
      (component, addedEdgesTreeName, addedEdgesColor)
    )
    val removedEdgesTrees = connectedComponents(removedEdges).map(component =>
      (component, removedEdgesTreeName, removedEdgesColor)
    )
    // A Vector is used, as appending to a List would take quadratic time for many components
    val (trees, _) = (addedEdgesTrees ++ removedEdgesTrees).zipWithIndex.foldLeft((Vector.empty[Tree], 1)) {
      case ((treesAcc, firstNodeId), ((componentEdges, name, color), treeIdx)) =>
        val tree = edgesAsTree(componentEdges, positionsBySegmentId, treeId = treeIdx + 1, firstNodeId, now)
          .copy(
            name = name,
            color = Some(color),
            metadata =
              Seq(MetadataEntryProto(referenceAgglomerateIdMetadataKey, stringValue = Some(referenceAgglomerateId.toString)))
          )
        (treesAcc :+ tree, firstNodeId + tree.nodes.length)
    }

    SkeletonTracingDefaults.createInstance.copy(trees = trees)
  }

  private def connectedComponents(edges: Seq[AgglomerateEdge]): Seq[Seq[AgglomerateEdge]] = {
    val parent = scala.collection.mutable.Map[Long, Long]()
    // Iterative (instead of recursive) to avoid stack overflows for long chains of segments
    def find(segmentId: Long): Long = {
      var root = segmentId
      while (parent.getOrElseUpdate(root, root) != root) root = parent(root)
      var current = segmentId
      while (current != root) {
        val next = parent(current)
        parent(current) = root
        current = next
      }
      root
    }
    edges.foreach(edge => parent(find(edge.source)) = find(edge.target))
    // groupBy does not preserve the order, so sort the components by their first edge for deterministic results
    edges.zipWithIndex
      .groupBy { case (edge, _) => find(edge.source) }
      .values
      .toSeq
      .sortBy(_.head._2)
      .map(_.map(_._1))
  }

  private def edgesAsTree(
      edges: Seq[AgglomerateEdge],
      positionsBySegmentId: Map[Long, Vec3IntProto],
      treeId: Int,
      firstNodeId: Int,
      createdTimestamp: Long
  ): Tree = {
    val segmentIdsOfNodes = edges.flatMap(edge => Seq(edge.source, edge.target)).distinct
    val nodeIdBySegmentId = segmentIdsOfNodes.zipWithIndex.map { case (segmentId, idx) =>
      segmentId -> (idx + firstNodeId)
    }.toMap
    val nodes = segmentIdsOfNodes.map { segmentId =>
      NodeDefaults.createInstance.copy(
        id = nodeIdBySegmentId(segmentId),
        position = positionsBySegmentId.getOrElse(segmentId, Vec3IntProto(0, 0, 0)),
        createdTimestamp = createdTimestamp
      )
    }
    val treeEdges = edges.map(edge => Edge(nodeIdBySegmentId(edge.source), nodeIdBySegmentId(edge.target)))
    Tree(
      treeId = treeId,
      nodes = nodes,
      edges = treeEdges,
      name = "",
      createdTimestamp = createdTimestamp,
      `type` = Some(TreeTypeProto.DEFAULT)
    )
  }
}
