package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.webknossos.datastore.AgglomerateGraph.{
  AgglomerateEdge,
  AgglomerateGraph,
  AgglomerateGraphDiff
}

/*
 * Compares the graph of one agglomerate with the graph of one agglomerate of a reference mapping
 * (the reference agglomerate):
 * - Added edges are all edges of the agglomerate that are not part of the reference graph. For a merge, this
 *   includes the merged-in parts (everything outside of the reference agglomerate).
 * - Removed edges are reference edges with at least one endpoint in the agglomerate that are not part of the
 *   agglomerate graph. For a split, the other endpoint lies outside of the agglomerate, so the edges are dangling
 *   and lead to the first segment outside of the agglomerate. The split-off parts are not included, as these might
 *   be huge.
 * The edges are returned as plain lists. They are only shown in a local overlay, so in contrast to annotation trees,
 * they don't need to be split into connected components.
 */
object AgglomerateGraphDiffer {

  // Edges are undirected, so (a, b) and (b, a) map to the same key
  private def edgeKey(edge: AgglomerateEdge): (Long, Long) =
    if (edge.source <= edge.target) (edge.source, edge.target) else (edge.target, edge.source)

  def diff(
      graph: AgglomerateGraph,
      referenceGraph: AgglomerateGraph,
      referenceAgglomerateId: Long
  ): AgglomerateGraphDiff = {
    // The reference agglomerate might be a huge merger, so only lookup structures for the (smaller) part that
    // touches the agglomerate are built. The reference graph itself is only iterated over.
    val segmentIds = graph.segments.toSet
    val edgeKeys = graph.edges.map(edgeKey).toSet
    val referenceEdgesTouchingAgglomerate =
      referenceGraph.edges.filter(edge => segmentIds.contains(edge.source) || segmentIds.contains(edge.target))
    val referenceEdgeKeysTouchingAgglomerate = referenceEdgesTouchingAgglomerate.map(edgeKey).toSet

    // An edge of the agglomerate can only be part of the reference graph if it is one of the reference edges
    // that touch the agglomerate.
    val addedEdges =
      graph.edges.filterNot(edge => referenceEdgeKeysTouchingAgglomerate.contains(edgeKey(edge))).distinctBy(edgeKey)
    val removedEdges =
      referenceEdgesTouchingAgglomerate.filterNot(edge => edgeKeys.contains(edgeKey(edge))).distinctBy(edgeKey)

    val endpointSegmentIds = (addedEdges ++ removedEdges).flatMap(edge => Seq(edge.source, edge.target)).distinct
    val indexBySegmentId = endpointSegmentIds.zipWithIndex.toMap

    // Positions from the agglomerate graph take precedence, reference positions are only used for the dangling
    // ends of removed edges.
    def positionsOfEndpoints(sourceGraph: AgglomerateGraph) =
      sourceGraph.segments.iterator
        .zip(sourceGraph.positions.iterator)
        .filter { case (segmentId, _) =>
          indexBySegmentId.contains(segmentId)
        }
        .toMap
    val positionBySegmentId = positionsOfEndpoints(referenceGraph) ++ positionsOfEndpoints(graph)

    def asIndices(edges: Seq[AgglomerateEdge]): Seq[Int] =
      edges.flatMap(edge => Seq(indexBySegmentId(edge.source), indexBySegmentId(edge.target)))

    AgglomerateGraphDiff(
      referenceAgglomerateId = referenceAgglomerateId,
      // Every endpoint is a segment of one of the graphs, so its position is known
      positions = endpointSegmentIds.flatMap { segmentId =>
        val position = positionBySegmentId(segmentId)
        Seq(position.x, position.y, position.z)
      },
      addedEdges = asIndices(addedEdges),
      removedEdges = asIndices(removedEdges)
    )
  }
}
