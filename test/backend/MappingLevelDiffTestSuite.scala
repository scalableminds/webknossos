package backend

import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.MappingLevelDiff
import org.scalatest.wordspec.AnyWordSpec

class MappingLevelDiffTestSuite extends AnyWordSpec {

  // Builds an agglomerate graph from a set of segment ids and undirected edges (given as (a, b) pairs).
  private def graph(segments: Seq[Long], edges: Seq[(Long, Long)]): AgglomerateGraph =
    AgglomerateGraph(
      segments = segments,
      edges = edges.map { case (a, b) => AgglomerateEdge(a, b) },
      positions = segments.map(s => Vec3IntProto(s.toInt, s.toInt, s.toInt)),
      affinities = edges.map(_ => 1.0f)
    )

  private def normalizedSet(edges: Seq[(Long, Long)]): Set[(Long, Long)] =
    edges.map { case (a, b) => MappingLevelDiff.normalizeEdge(a, b) }.toSet

  "MappingLevelDiff.computeEdgeChanges" should {

    "add edges when the target level is more merged (no existing edits)" in {
      val current = graph(Seq(1L, 2L, 3L), Seq((1L, 2L)))
      val target = graph(Seq(1L, 2L, 3L), Seq((1L, 2L), (2L, 3L)))
      val (toAdd, toRemove) = MappingLevelDiff.computeEdgeChanges(current, target, Seq.empty)
      assert(normalizedSet(toAdd) == Set((2L, 3L)))
      assert(toRemove.isEmpty)
    }

    "remove edges when the target level is less merged (no existing edits)" in {
      val current = graph(Seq(1L, 2L, 3L), Seq((1L, 2L), (2L, 3L)))
      val target = graph(Seq(1L, 2L, 3L), Seq((1L, 2L)))
      val (toAdd, toRemove) = MappingLevelDiff.computeEdgeChanges(current, target, Seq.empty)
      assert(toAdd.isEmpty)
      assert(normalizedSet(toRemove) == Set((2L, 3L)))
    }

    "treat edges as undirected regardless of source/target order" in {
      val current = graph(Seq(1L, 2L), Seq((2L, 1L)))
      val target = graph(Seq(1L, 2L), Seq((1L, 2L)))
      val (toAdd, toRemove) = MappingLevelDiff.computeEdgeChanges(current, target, Seq.empty)
      assert(toAdd.isEmpty)
      assert(toRemove.isEmpty)
    }

    "not re-add an edge the user manually split, even though the target level has it" in {
      // User previously split (2,3). Target level would reconnect it, but the manual split must win.
      val current = graph(Seq(1L, 2L, 3L), Seq((1L, 2L)))
      val target = graph(Seq(1L, 2L, 3L), Seq((1L, 2L), (2L, 3L)))
      val editedEdges = Seq((2L, 3L, false)) // false == manual split
      val (toAdd, toRemove) = MappingLevelDiff.computeEdgeChanges(current, target, editedEdges)
      assert(toAdd.isEmpty)
      assert(toRemove.isEmpty)
    }

    "not remove an edge the user manually merged, even though the target level lacks it" in {
      // User previously merged (2,3). Target level would disconnect it, but the manual merge must win.
      val current = graph(Seq(1L, 2L, 3L), Seq((1L, 2L), (2L, 3L)))
      val target = graph(Seq(1L, 2L, 3L), Seq((1L, 2L)))
      val editedEdges = Seq((2L, 3L, true)) // true == manual merge
      val (toAdd, toRemove) = MappingLevelDiff.computeEdgeChanges(current, target, editedEdges)
      assert(toAdd.isEmpty)
      assert(toRemove.isEmpty)
    }

    "let the newest edit win when an edge was edited multiple times" in {
      // Edge (2,3) was split then later merged; the newest (merge) wins, so a target removal must be suppressed.
      val current = graph(Seq(1L, 2L, 3L), Seq((1L, 2L), (2L, 3L)))
      val target = graph(Seq(1L, 2L, 3L), Seq((1L, 2L)))
      val editedEdges = Seq((2L, 3L, false), (2L, 3L, true)) // chronological: split, then merge
      val (toAdd, toRemove) = MappingLevelDiff.computeEdgeChanges(current, target, editedEdges)
      assert(toAdd.isEmpty)
      assert(toRemove.isEmpty)
    }
  }

  "MappingLevelDiff.buildPreviewGraph" should {

    "produce a consistent graph reflecting adds and removes" in {
      val current = graph(Seq(1L, 2L, 3L), Seq((1L, 2L), (2L, 3L)))
      val target = graph(Seq(1L, 2L, 3L, 4L), Seq((1L, 2L), (3L, 4L)))
      val (toAdd, toRemove) = MappingLevelDiff.computeEdgeChanges(current, target, Seq.empty)
      val preview = MappingLevelDiff.buildPreviewGraph(current, target, toAdd, toRemove)
      val previewEdges = normalizedSet(preview.edges.map(e => (e.source, e.target)))
      // (2,3) removed, (3,4) added, (1,2) kept.
      assert(previewEdges == Set((1L, 2L), (3L, 4L)))
      // Positions must be parallel to segments and every edge endpoint must be a listed segment.
      assert(preview.segments.length == preview.positions.length)
      assert(preview.edges.forall(e => preview.segments.contains(e.source) && preview.segments.contains(e.target)))
      assert(preview.affinities.length == preview.edges.length)
    }
  }
}
