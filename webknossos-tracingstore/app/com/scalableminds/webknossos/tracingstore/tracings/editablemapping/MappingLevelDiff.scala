package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}

// Pure (dependency-free) edge-diff logic for the "select mapping level per agglomerate" proofreading feature.
// Kept separate from EditableMappingService so it can be unit-tested without the service's DI dependencies.
// See SPIKE-per-agglomerate-mapping-level.md for the overall design.
object MappingLevelDiff {

  def normalizeEdge(a: Long, b: Long): (Long, Long) = if (a <= b) (a, b) else (b, a)

  // Edge-set diff between the current effective graph (locked level + existing edits) and a target-level graph.
  // Rule: manual edits from the tracing store always win, so we never re-add an edge the user manually split and
  // never remove an edge the user manually merged. Returns (edgesToAdd, edgesToRemove) as normalized segment-id pairs.
  // editedEdges is expected in chronological order; the last edit per edge wins.
  def computeEdgeChanges(
      currentGraph: AgglomerateGraph,
      targetGraph: AgglomerateGraph,
      editedEdges: Seq[(Long, Long, Boolean)]
  ): (Seq[(Long, Long)], Seq[(Long, Long)]) = {
    val currentEdgeSet: Set[(Long, Long)] = currentGraph.edges.map(e => normalizeEdge(e.source, e.target)).toSet
    val targetEdgeSet: Set[(Long, Long)] = targetGraph.edges.map(e => normalizeEdge(e.source, e.target)).toSet
    val editedByPair: Map[(Long, Long), Boolean] =
      editedEdges.foldLeft(Map.empty[(Long, Long), Boolean]) { case (acc, (a, b, isMerge)) =>
        acc + (normalizeEdge(a, b) -> isMerge)
      }
    val rawAdd = targetEdgeSet.diff(currentEdgeSet)
    val rawRemove = currentEdgeSet.diff(targetEdgeSet)
    val edgesToAdd = rawAdd.filterNot(pair => editedByPair.get(pair).contains(false)).toSeq // keep user's manual split
    val edgesToRemove = rawRemove.filterNot(pair => editedByPair.get(pair).contains(true)).toSeq // keep user's manual merge
    (edgesToAdd, edgesToRemove)
  }

  // Best-effort reconstruction of the resulting agglomerate graph, for skeleton preview rendering only.
  // The committed result (materialized in EditableMappingUpdater) is the source of truth; this may differ from it
  // in the cross-agglomerate "swallow" case (see SPIKE-per-agglomerate-mapping-level.md).
  def buildPreviewGraph(
      currentGraph: AgglomerateGraph,
      targetGraph: AgglomerateGraph,
      edgesToAdd: Seq[(Long, Long)],
      edgesToRemove: Seq[(Long, Long)]
  ): AgglomerateGraph = {
    val positionBySegment =
      (currentGraph.segments.zip(currentGraph.positions) ++ targetGraph.segments.zip(targetGraph.positions)).toMap
    val removeSet = edgesToRemove.map { case (a, b) => normalizeEdge(a, b) }.toSet
    val addSet = edgesToAdd.map { case (a, b) => normalizeEdge(a, b) }.toSet
    val resultingEdgePairs: Set[(Long, Long)] =
      currentGraph.edges.map(e => normalizeEdge(e.source, e.target)).toSet.diff(removeSet).union(addSet)
    val resultingSegments: Seq[Long] =
      (currentGraph.segments.toSet ++ resultingEdgePairs.flatMap { case (a, b) => Set(a, b) })
        .filter(positionBySegment.contains)
        .toSeq
    val resultingSegmentSet = resultingSegments.toSet
    val resultingEdges = resultingEdgePairs.toSeq.collect {
      case (a, b) if resultingSegmentSet.contains(a) && resultingSegmentSet.contains(b) => AgglomerateEdge(a, b)
    }
    AgglomerateGraph(
      segments = resultingSegments,
      edges = resultingEdges,
      positions = resultingSegments.map(positionBySegment),
      affinities = Seq.fill(resultingEdges.length)(1.0f)
    )
  }
}
