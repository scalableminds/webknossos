package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.scalableminds.util.datastructures.UnionFind
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import net.liftweb.common.{Box, Failure, Full}

import scala.collection.mutable

object TreeValidator {

  def validateTrees(trees: Seq[Tree],
                    treeGroups: Seq[TreeGroup],
                    branchPoints: Seq[BranchPoint],
                    comments: Seq[Comment]): Box[Unit] =
    for {
      _ <- checkNoDuplicateTreeIds(trees)
      _ <- checkNoDuplicateNodeIds(trees)
      _ <- checkNoDuplicateEdges(trees)
      _ <- checkAllNodesUsedInEdgesExist(trees)
      _ <- checkNoEdgesWithSameSourceAndTarget(trees)
      _ <- checkTreesAreConnected(trees)
      _ <- checkNoDuplicateTreeGroupIds(treeGroups)
      _ <- checkAllTreeGroupIdsUsedExist(trees, treeGroups)
      _ <- checkAllNodesUsedInBranchPointsExist(trees, branchPoints)
      _ <- checkAllNodesUsedInCommentsExist(trees, comments)
    } yield Full(())

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

  private def checkNoDuplicateEdges(trees: Seq[Tree]): Box[Unit] =
    foldOverTrees(trees) { tree =>
      val duplicateEdges = findDuplicateEdges(tree.edges)
      if (duplicateEdges.isEmpty) {
        Full(())
      } else {
        Failure(s"Duplicate edges in tree ${tree.treeId}: ${duplicateEdges.mkString(", ")}")
      }
    }

  private def findDuplicateEdges(edges: Seq[Edge]): Seq[Edge] = {
    val duplicates = Seq.newBuilder[Edge]
    val seen = mutable.HashSet[Edge]()
    for (x <- edges) {
      if (seen(x) || seen(Edge(x.target, x.source))) {
        duplicates += x
      } else {
        seen += x
      }
    }
    duplicates.result()
  }

  private def checkAllNodesUsedInEdgesExist(trees: Seq[Tree]): Box[Unit] =
    foldOverTrees(trees) { tree =>
      val nodesInTree = tree.nodes.map(_.id)
      val nodesInEdges = tree.edges.flatMap(edge => Seq(edge.source, edge.target)).distinct
      val nodesOnlyInEdges = nodesInEdges.diff(nodesInTree)
      if (nodesOnlyInEdges.isEmpty) {
        Full(())
      } else {
        Failure(
          s"Some edges refer to non-existent nodes. treeId: ${tree.treeId}, nodeIds: ${nodesOnlyInEdges.mkString(", ")}")
      }
    }

  private def checkNoEdgesWithSameSourceAndTarget(trees: Seq[Tree]): Box[Unit] =
    foldOverTrees(trees) { tree =>
      val invalidEdges = tree.edges.filter { edge =>
        edge.source == edge.target
      }
      if (invalidEdges.isEmpty) {
        Full(())
      } else {
        Failure(
          s"Some edges have the same source and target. treeId: ${tree.treeId}, edges: ${invalidEdges.mkString(", ")}")
      }
    }

  private def checkTreesAreConnected(trees: Seq[Tree]): Box[Unit] =
    foldOverTrees(trees) { tree =>
      val treeComponents = UnionFind(tree.nodes.map(_.id))
      tree.edges.foreach { edge =>
        treeComponents.union(edge.source, edge.target)
      }
      val treeComponentCount = treeComponents.size

      if (treeComponentCount <= 1) {
        Full(())
      } else {
        Failure(s"Tree ${tree.treeId} is not fully connected, but consists of $treeComponentCount components.")
      }
    }

  def checkAllNodesUsedInCommentsExist(trees: Seq[Tree], comments: Seq[Comment]): Box[Unit] =
    checkAllNodesUsedExist(trees, comments.map(_.nodeId).distinct, "comments")

  def checkAllNodesUsedInBranchPointsExist(trees: Seq[Tree], branchPoints: Seq[BranchPoint]): Box[Unit] =
    checkAllNodesUsedExist(trees, branchPoints.map(_.nodeId).distinct, "branchPoints")

  def checkNoDuplicateTreeGroupIds(treeGroups: Seq[TreeGroup]): Box[Unit] = {
    val treeGroupIds = TreeUtils.getAllTreeGroupIds(treeGroups)
    val distinctTreeGroupIds = treeGroupIds.distinct
    if (treeGroupIds.size == distinctTreeGroupIds.size) {
      Full(())
    } else {
      Failure(s"Duplicate treeGroupIds: ${treeGroupIds.diff(distinctTreeGroupIds).mkString(", ")}")
    }
  }

  def checkAllTreeGroupIdsUsedExist(trees: Seq[Tree], treeGroups: Seq[TreeGroup]): Box[Unit] = {
    val existingTreeGroups = TreeUtils.getAllTreeGroupIds(treeGroups)
    val treeGroupsInTrees = trees.flatMap(_.groupId).distinct

    val treeGroupsOnlyInTrees = treeGroupsInTrees.diff(existingTreeGroups)
    if (treeGroupsOnlyInTrees.isEmpty) {
      Full(())
    } else {
      Failure(s"Some treeGroups used in trees don't exist. treeGroups: ${treeGroupsOnlyInTrees.mkString(", ")}")
    }
  }

  private def foldOverTrees(trees: Seq[Tree])(block: Tree => Box[Unit]) =
    trees.foldLeft[Box[Unit]](Full(())) {
      case (Full(()), tree) =>
        block(tree)
      case (f, _) =>
        f
    }

  private def checkAllNodesUsedExist(trees: Seq[Tree], usedNodes: Seq[Int], nodeName: String) = {
    val nodesInAllTrees = trees.flatMap(_.nodes).map(_.id)

    val nodesUsedButNonExistent = usedNodes.diff(nodesInAllTrees)
    if (nodesUsedButNonExistent.isEmpty) {
      Full(())
    } else {
      Failure(s"Some $nodeName refer to non-existent nodes. $nodeName: ${nodesUsedButNonExistent.mkString(", ")}")
    }
  }
}
