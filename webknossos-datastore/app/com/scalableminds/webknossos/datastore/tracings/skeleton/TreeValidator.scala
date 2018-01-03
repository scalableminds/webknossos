package com.scalableminds.webknossos.datastore.tracings.skeleton

import com.scalableminds.webknossos.datastore.SkeletonTracing.Tree
import com.scalableminds.util.datastructures.UnionFind
import net.liftweb.common.{Box, Failure, Full}

object TreeValidator {

  def validateTrees(trees: Seq[Tree]): Box[Unit] = {
    for {
      _ <- checkNoDuplicateTreeIds(trees)
      _ <- checkNoDuplicateNodeIds(trees)
      _ <- checkAllNodesUsedInEdgesExist(trees)
      _ <- checkTreesAreConnected(trees)
    } yield Full(())
  }

  private def checkNoDuplicateTreeIds(trees: Seq[Tree]): Box[Unit] = {
    val treeIds = trees.map(_.treeId)
    val distinctTreeIds = treeIds.distinct
    if (treeIds.size == distinctTreeIds.size) {
      Full(())
    } else {
      Failure(s"Duplicate treeIds: ${treeIds.diff(distinctTreeIds).mkString(", ")}")
    }
  }

  private def checkNoDuplicateNodeIds(trees: Seq[Tree]): Box[Unit] = {
    val nodeIds = trees.flatMap(_.nodes).map(_.id)
    val distinctNodeIds = nodeIds.distinct
    if (nodeIds.size == distinctNodeIds.size) {
      Full(())
    } else {
      Failure(s"Duplicate nodeIds: ${nodeIds.diff(distinctNodeIds).mkString(", ")}")
    }
  }

  private def checkAllNodesUsedInEdgesExist(trees: Seq[Tree]): Box[Unit] = {
    trees.foldLeft[Box[Unit]](Full(())){
      case (Full(()), tree) =>
        val nodesInTree = tree.nodes.map(_.id)
        val nodesInEdges = tree.edges.flatMap(edge => Seq(edge.source, edge.target)).distinct
        val nodesOnlyInEdges = nodesInEdges.diff(nodesInTree)
        if (nodesOnlyInEdges.isEmpty) {
          Full(())
        } else {
          Failure(s"Some edges refer to non-existent nodes. treeId: ${tree.treeId}, nodeIds: ${nodesOnlyInEdges.mkString(", ")}")
        }
      case (f, _) =>
        f
    }
  }

  private def checkTreesAreConnected(trees: Seq[Tree]): Box[Unit] = {
    trees.foldLeft[Box[Unit]](Full(())){
      case (Full(()), tree) =>
        val treeComponents = UnionFind(tree.nodes.map(_.id))
        tree.edges.foreach { edge =>
          treeComponents.union(edge.source, edge.target)
        }
        val treeComponentCount = treeComponents.size

        if (treeComponentCount == 1) {
          Full(())
        } else {
          Failure(s"Tree ${tree.treeId} is not fully connected, but consists of $treeComponentCount components.")
        }
      case (f, _) =>
        f
    }
  }
}
