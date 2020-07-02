package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.scalableminds.webknossos.tracingstore.SkeletonTracing.Tree
import org.jgrapht.alg.connectivity.ConnectivityInspector
import org.jgrapht.graph.{Multigraph, _}
import scala.collection.JavaConverters._

object MultiComponentTreeSplitter {

  //TODO add tree group as well, get rid of var for maxId

  def splitMulticomponentTrees(trees: Seq[Tree]): Seq[Tree] = {
    var largestTreeId = if (trees.isEmpty) 0 else trees.map(_.treeId).max
    val treeLists = trees.map { tree =>
      var g = new Multigraph[Int, DefaultEdge](classOf[DefaultEdge])
      tree.nodes.foreach { node =>
        g.addVertex(node.id)
      }
      tree.edges.foreach { edge =>
        g.addEdge(edge.source, edge.target)
      }
      val inspector = new ConnectivityInspector[Int, DefaultEdge](g)
      val connectedSets: java.util.List[java.util.Set[Int]] = inspector.connectedSets()
      println(s"Connected Sets: $connectedSets")
      if (connectedSets.size() <= 1) {
        List(tree)
      } else {
        connectedSets.asScala.zipWithIndex.map {
          case (connectedNodeSet, index) =>
            val nodes = tree.nodes.filter(node => connectedNodeSet.contains(node.id))
            val edges = tree.edges.filter(edge =>
              connectedNodeSet.contains(edge.source) && connectedNodeSet.contains(edge.target))
            val branchPoints = tree.branchPoints.filter(bp => connectedNodeSet.contains(bp.nodeId))
            val comments = tree.comments.filter(comment => connectedNodeSet.contains(comment.nodeId))
            val treeId = largestTreeId
            val name = tree.name + "_" + index
            largestTreeId += 1
            Tree(treeId,
                 nodes,
                 edges,
                 tree.color,
                 branchPoints,
                 comments,
                 name,
                 tree.createdTimestamp,
                 tree.groupId,
                 tree.isVisible)
        }
      }
    }
    treeLists.flatten
  }
}
