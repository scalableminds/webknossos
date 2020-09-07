package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.scalableminds.webknossos.tracingstore.SkeletonTracing.{Tree, TreeGroup}
import org.jgrapht.alg.connectivity.ConnectivityInspector
import org.jgrapht.graph.{Multigraph, _}

import scala.collection.JavaConverters._

object MultiComponentTreeSplitter {

  def splitMulticomponentTrees(trees: Seq[Tree], treeGroups: Seq[TreeGroup]): (Seq[Tree], Seq[TreeGroup]) = {
    var largestTreeId = if (trees.isEmpty) 0 else trees.map(_.treeId).max
    var largestGroupId = if (treeGroups.isEmpty) 0 else treeGroups.map(_.groupId).max
    var treeGroupsMutable: Seq[TreeGroup] = treeGroups
    val treeLists = trees.map { tree =>
      val g = new Multigraph[Int, DefaultEdge](classOf[DefaultEdge])
      tree.nodes.foreach { node =>
        g.addVertex(node.id)
      }
      tree.edges.foreach { edge =>
        g.addEdge(edge.source, edge.target)
      }
      val inspector = new ConnectivityInspector[Int, DefaultEdge](g)
      val connectedSets: java.util.List[java.util.Set[Int]] = inspector.connectedSets()
      if (connectedSets.size() <= 1) {
        List(tree)
      } else {
        largestGroupId += 1
        val newTreeGroup = TreeGroup(tree.name, largestGroupId, List())
        val parentTreeGroupIdOpt: Option[Int] = tree.groupId
        parentTreeGroupIdOpt.foreach { parentTreeGroupId =>
          treeGroupsMutable = addTreeGroupAsChild(treeGroupsMutable, parentTreeGroupId, newTreeGroup)
        }
        if (parentTreeGroupIdOpt.isEmpty) {
          treeGroupsMutable = newTreeGroup +: treeGroupsMutable
        }

        connectedSets.asScala.zipWithIndex.map {
          case (connectedNodeSet, index) =>
            val nodes = tree.nodes.filter(node => connectedNodeSet.contains(node.id))
            val edges = tree.edges.filter(edge =>
              connectedNodeSet.contains(edge.source) && connectedNodeSet.contains(edge.target))
            val branchPoints = tree.branchPoints.filter(bp => connectedNodeSet.contains(bp.nodeId))
            val comments = tree.comments.filter(comment => connectedNodeSet.contains(comment.nodeId))
            largestTreeId += 1
            val treeId = largestTreeId
            val name = tree.name + "_" + index
            Tree(treeId,
                 nodes,
                 edges,
                 tree.color,
                 branchPoints,
                 comments,
                 name,
                 tree.createdTimestamp,
                 Some(largestGroupId),
                 tree.isVisible)
        }
      }
    }
    (treeLists.flatten, treeGroupsMutable)
  }

  def addTreeGroupAsChild(treeGroups: Seq[TreeGroup], parentTreeGroupId: Int, newTreeGroup: TreeGroup): Seq[TreeGroup] =
    treeGroups.map { treeGroup =>
      if (treeGroup.groupId == parentTreeGroupId) {
        treeGroup.copy(children = newTreeGroup +: treeGroup.children)
      } else {
        if (treeGroup.children.isEmpty) {
          treeGroup
        } else {
          treeGroup.copy(children = addTreeGroupAsChild(treeGroup.children, parentTreeGroupId, newTreeGroup))
        }
      }
    }

}
