package backend

import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph, AgglomerateGraphDiff}
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.services.mapping.AgglomerateGraphDiffer
import org.scalatest.wordspec.AnyWordSpec

class AgglomerateGraphDifferTestSuite extends AnyWordSpec {

  // The positions encode the segment ids, so that the endpoints of the edges can be identified
  private def position(segmentId: Long) = Vec3IntProto(segmentId.toInt, 2 * segmentId.toInt, 3 * segmentId.toInt)

  private def graph(segments: Seq[Long], edges: Seq[(Long, Long)]): AgglomerateGraph =
    AgglomerateGraph(
      segments = segments,
      edges = edges.map { case (source, target) => AgglomerateEdge(source, target) },
      positions = segments.map(position),
      affinities = edges.map(_ => 1.0f)
    )

  private def diff(graph: AgglomerateGraph, referenceGraph: AgglomerateGraph): AgglomerateGraphDiff = {
    val result = AgglomerateGraphDiffer.diff(graph, referenceGraph, referenceAgglomerateId = 7)
    assert(result.referenceAgglomerateId == 7)
    assert(result.positions.length % 3 == 0)
    assert(endpointSegmentIds(result).distinct == endpointSegmentIds(result))
    endpointSegmentIds(result).zip(result.positions.grouped(3)).foreach { case (segmentId, p) =>
      assert(p.map(_.toLong) == Seq(segmentId, 2 * segmentId, 3 * segmentId))
    }
    result
  }

  private def endpointSegmentIds(result: AgglomerateGraphDiff): Seq[Long] =
    result.positions.grouped(3).map(_.head.toLong).toSeq

  // Converts the flat index pairs back to undirected edges between segment ids
  private def edgesAsSegmentIds(result: AgglomerateGraphDiff, indices: Seq[Int]): Set[Set[Long]] =
    indices.grouped(2).map(pair => pair.map(endpointSegmentIds(result)).toSet).toSet

  private def addedAndRemoved(graph: AgglomerateGraph, referenceGraph: AgglomerateGraph) = {
    val result = diff(graph, referenceGraph)
    (edgesAsSegmentIds(result, result.addedEdges), edgesAsSegmentIds(result, result.removedEdges))
  }

  "AgglomerateGraphDiffer" should {
    "report no differences for identical graphs, regardless of edge direction" in {
      val result = diff(graph(Seq(1, 2, 3), Seq((1, 2), (2, 3))), graph(Seq(1, 2, 3), Seq((2, 1), (3, 2))))
      assert(result.addedEdges.isEmpty)
      assert(result.removedEdges.isEmpty)
      assert(result.positions.isEmpty)
    }

    "report the merging edge and the merged-in part as added when two reference agglomerates were merged" in {
      val (added, removed) =
        addedAndRemoved(graph(Seq(1, 2, 3, 4), Seq((1, 2), (2, 3), (3, 4))), graph(Seq(1, 2), Seq((1, 2))))
      // Edge 3-4 belongs to the merged-in reference agglomerate
      assert(added == Set(Set(2L, 3L), Set(3L, 4L)))
      assert(removed.isEmpty)
    }

    "report the splitting edge as removed (dangling) when a reference agglomerate was split" in {
      val result = diff(graph(Seq(1, 2), Seq((1, 2))), graph(Seq(1, 2, 3, 4), Seq((1, 2), (2, 3), (3, 4))))
      assert(result.addedEdges.isEmpty)
      // Edge 3-4 belongs to the other part of the split and is not reported
      assert(edgesAsSegmentIds(result, result.removedEdges) == Set(Set(2L, 3L)))
      // The position of the dangling end is taken from the reference graph
      assert(endpointSegmentIds(result).toSet == Set(2L, 3L))
    }

    "report both merging and splitting edges" in {
      val result = diff(graph(Seq(1, 2, 5), Seq((1, 2), (2, 5))), graph(Seq(1, 2, 3), Seq((1, 2), (2, 3))))
      assert(edgesAsSegmentIds(result, result.addedEdges) == Set(Set(2L, 5L)))
      assert(edgesAsSegmentIds(result, result.removedEdges) == Set(Set(2L, 3L)))
      // Segment 2 is an endpoint of both edges, but is only listed once
      assert(endpointSegmentIds(result).sorted == Seq(2L, 3L, 5L))
    }

    "report disconnected added edges" in {
      val (added, removed) = addedAndRemoved(
        graph(Seq(1, 2, 3, 4, 5, 6), Seq((1, 2), (2, 3), (3, 4), (4, 5), (5, 6))),
        graph(Seq(1, 2, 3, 4, 5, 6), Seq((1, 2), (3, 4), (5, 6)))
      )
      assert(added == Set(Set(2L, 3L), Set(4L, 5L)))
      assert(removed.isEmpty)
    }

    "report duplicate edges only once" in {
      val result = diff(graph(Seq(1, 2), Seq((1, 2), (2, 1))), graph(Seq(1, 2), Seq.empty))
      assert(result.addedEdges.length == 2)
    }

    "report rewired edges within the same agglomerate" in {
      val (added, removed) =
        addedAndRemoved(graph(Seq(1, 2, 3), Seq((1, 2), (1, 3))), graph(Seq(1, 2, 3), Seq((1, 2), (2, 3))))
      assert(added == Set(Set(1L, 3L)))
      assert(removed == Set(Set(2L, 3L)))
    }
  }
}
