package backend

import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.SkeletonTracing.Tree
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.services.mapping.AgglomerateGraphDiff
import org.scalatest.wordspec.AnyWordSpec

class AgglomerateGraphDiffTestSuite extends AnyWordSpec {

  private def graph(segments: Seq[Long], edges: Seq[(Long, Long)]): AgglomerateGraph =
    AgglomerateGraph(
      segments = segments,
      edges = edges.map { case (source, target) => AgglomerateEdge(source, target) },
      positions = segments.map(segmentId => Vec3IntProto(segmentId.toInt, 0, 0)),
      affinities = edges.map(_ => 1.0f)
    )

  // Returns the edges of a tree as sets of the x coordinates of their nodes (which equal the segment ids here)
  private def edgesAsSegmentIds(tree: Tree): Set[Set[Long]] = {
    val segmentIdByNodeId = tree.nodes.map(node => node.id -> node.position.x.toLong).toMap
    tree.edges.map(edge => Set(segmentIdByNodeId(edge.source), segmentIdByNodeId(edge.target))).toSet
  }

  private def diffTrees(graph: AgglomerateGraph, referenceGraph: AgglomerateGraph) = {
    val trees = AgglomerateGraphDiff.diffAsSkeleton(graph, referenceGraph, referenceAgglomerateId = 7).trees
    assert(trees.flatMap(_.nodes.map(_.id)).distinct.length == trees.map(_.nodes.length).sum)
    assert(trees.map(_.treeId).distinct.length == trees.length)
    // webknossos expects every tree to be connected
    trees.foreach(tree => assert(tree.edges.length >= tree.nodes.length - 1))
    trees
  }

  private def addedAndRemoved(graph: AgglomerateGraph, referenceGraph: AgglomerateGraph) = {
    val trees = diffTrees(graph, referenceGraph)
    def edgesOfTreesNamed(name: String) = trees.filter(_.name == name).flatMap(edgesAsSegmentIds).toSet
    (
      edgesOfTreesNamed(AgglomerateGraphDiff.addedEdgesTreeName),
      edgesOfTreesNamed(AgglomerateGraphDiff.removedEdgesTreeName)
    )
  }

  "AgglomerateGraphDiff" should {
    "report no differences for identical graphs, regardless of edge direction" in {
      val (added, removed) =
        addedAndRemoved(graph(Seq(1, 2, 3), Seq((1, 2), (2, 3))), graph(Seq(1, 2, 3), Seq((2, 1), (3, 2))))
      assert(added.isEmpty)
      assert(removed.isEmpty)
    }

    "report the merging edge and the merged-in part as added when two reference agglomerates were merged" in {
      val (added, removed) =
        addedAndRemoved(graph(Seq(1, 2, 3, 4), Seq((1, 2), (2, 3), (3, 4))), graph(Seq(1, 2), Seq((1, 2))))
      // Edge 3-4 belongs to the merged-in reference agglomerate
      assert(added == Set(Set(2L, 3L), Set(3L, 4L)))
      assert(removed.isEmpty)
    }

    "report merges within the merged-in part as added" in {
      val trees = diffTrees(
        graph(Seq(1, 2, 3, 4, 5), Seq((1, 2), (2, 3), (3, 4), (4, 5))),
        graph(Seq(1, 2), Seq((1, 2)))
      )
      // 2-3 merges into the reference agglomerate, 4-5 merges further out; all form one tree
      assert(trees.length == 1)
      assert(edgesAsSegmentIds(trees.head) == Set(Set(2L, 3L), Set(3L, 4L), Set(4L, 5L)))
    }

    "report the splitting edge as removed (dangling) when a reference agglomerate was split" in {
      val (added, removed) =
        addedAndRemoved(graph(Seq(1, 2), Seq((1, 2))), graph(Seq(1, 2, 3, 4), Seq((1, 2), (2, 3), (3, 4))))
      assert(added.isEmpty)
      // Edge 3-4 belongs to the other part of the split and is not reported
      assert(removed == Set(Set(2L, 3L)))
    }

    "report both merging and splitting edges" in {
      val (added, removed) =
        addedAndRemoved(graph(Seq(1, 2, 5), Seq((1, 2), (2, 5))), graph(Seq(1, 2, 3), Seq((1, 2), (2, 3))))
      assert(added == Set(Set(2L, 5L)))
      assert(removed == Set(Set(2L, 3L)))
    }

    "create one tree per connected component of added edges" in {
      val trees = diffTrees(
        graph(Seq(1, 2, 3, 4, 5, 6), Seq((1, 2), (2, 3), (3, 4), (4, 5), (5, 6))),
        graph(Seq(1, 2, 3, 4, 5, 6), Seq((1, 2), (3, 4), (5, 6)))
      )
      assert(trees.map(_.name) == Seq.fill(2)(AgglomerateGraphDiff.addedEdgesTreeName))
      assert(trees.map(edgesAsSegmentIds).toSet == Set(Set(Set(2L, 3L)), Set(Set(4L, 5L))))
    }

    "keep adjacent added edges in the same tree" in {
      val trees = diffTrees(graph(Seq(1, 2, 3), Seq((1, 2), (2, 3))), graph(Seq(1, 2, 3), Seq.empty))
      assert(trees.length == 1)
      assert(edgesAsSegmentIds(trees.head) == Set(Set(1L, 2L), Set(2L, 3L)))
    }

    "return no trees for identical graphs" in {
      assert(diffTrees(graph(Seq(1, 2), Seq((1, 2))), graph(Seq(1, 2), Seq((1, 2)))).isEmpty)
    }

    "report rewired edges within the same agglomerate" in {
      val (added, removed) =
        addedAndRemoved(graph(Seq(1, 2, 3), Seq((1, 2), (1, 3))), graph(Seq(1, 2, 3), Seq((1, 2), (2, 3))))
      assert(added == Set(Set(1L, 3L)))
      assert(removed == Set(Set(2L, 3L)))
    }

    "store the id of the reference agglomerate in the metadata of the trees" in {
      val trees = diffTrees(graph(Seq(1, 2), Seq((1, 2))), graph(Seq(1, 2), Seq.empty))
      assert(
        trees.head.metadata.find(_.key == AgglomerateGraphDiff.referenceAgglomerateIdMetadataKey).flatMap(_.stringValue)
          .contains("7")
      )
    }
  }
}
