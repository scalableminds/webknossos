package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.scalableminds.webknossos.datastore.SkeletonTracing.Tree

import scala.util.matching.Regex
import scala.util.matching.Regex.Match

object TreeUtils {
  type FunctionalNodeMapping = Function[Int, Int]
  type FunctionalGroupMapping = Function[Int, Int]
  type TreeIdMap = Map[Int, Int]

  val nodeIdReferenceRegex: Regex = "#([0-9]+)" r

  private def minNodeId(trees: Seq[Tree]) = {
    val nodes = trees.flatMap(_.nodes)
    if (nodes.isEmpty)
      0
    else
      nodes.map(_.id).min
  }

  private def maxNodeId(trees: Seq[Tree]) = {
    val nodes = trees.flatMap(_.nodes)
    if (nodes.isEmpty)
      0
    else
      nodes.map(_.id).max
  }

  def mergeTrees(sourceTrees: Seq[Tree],
                 targetTrees: Seq[Tree],
                 treeMappingSource: Map[Int, Int],
                 treeMappingTarget: Map[Int, Int],
                 nodeMapping: FunctionalNodeMapping,
                 groupMapping: FunctionalGroupMapping): Seq[Tree] = {
    val sourceNodeIds: Set[Int] = sourceTrees.flatMap(_.nodes.map(_.id)).toSet

    val mappedSourceTrees = sourceTrees.map(
      tree =>
        applyNodeMapping(tree.withTreeId(treeMappingSource(tree.treeId)), nodeMapping, sourceNodeIds)
          .copy(groupId = tree.groupId.map(groupMapping(_))))

    val mappedTargetTrees = targetTrees.map(tree => tree.withTreeId(treeMappingTarget(tree.treeId)))

    mappedTargetTrees ++ mappedSourceTrees
  }

  private def applyNodeMapping(tree: Tree, f: Int => Int, sourceNodeIds: Set[Int]) =
    tree
      .withNodes(tree.nodes.map(node => node.withId(f(node.id))))
      .withEdges(tree.edges.map(edge => edge.withSource(f(edge.source)).withTarget(f(edge.target))))
      .withComments(tree.comments.map(comment =>
        comment.withNodeId(f(comment.nodeId)).withContent(updateNodeReferences(comment.content, f, sourceNodeIds))))
      .withBranchPoints(tree.branchPoints.map(bp => bp.withNodeId(f(bp.nodeId))))

  private def updateNodeReferences(comment: String, f: Int => Int, sourceNodeIds: Set[Int]) = {
    def replacer(m: Match) = {
      val oldId = m.toString.substring(1).toInt
      val newId = if (sourceNodeIds.contains(oldId)) f(oldId) else oldId
      "#" + newId
    }
    nodeIdReferenceRegex.replaceAllIn(comment, m => replacer(m))
  }

  def calculateNodeMapping(sourceTrees: Seq[Tree], targetTrees: Seq[Tree]): Int => Int = {
    val nodeIdOffset = calculateNodeOffset(sourceTrees, targetTrees)
    (nodeId: Int) =>
      nodeId + nodeIdOffset
  }

  def calculateTreeMappings(sourceTrees: Seq[Tree], targetTrees: Seq[Tree]): (TreeIdMap, TreeIdMap) =
    (calculateTreeMapping(sourceTrees, targetTrees.length), calculateTreeMapping(targetTrees, 0))

  // We’re densifying the tree ids to avoid sparse ids growing too fast
  private def calculateTreeMapping(trees: Seq[Tree], offset: Int): Map[Int, Int] =
    trees
      .map(_.treeId)
      .sorted
      .zipWithIndex
      .map {
        case (treeId, index) => (treeId, index + 1 + offset)
      }
      .toMap

  private def calculateNodeOffset(sourceTrees: Seq[Tree], targetTrees: Seq[Tree]) =
    if (targetTrees.isEmpty)
      0
    else {
      val targetNodeMaxId = maxNodeId(targetTrees)
      val sourceNodeMinId = minNodeId(sourceTrees)
      math.max(targetNodeMaxId + 1 - sourceNodeMinId, 0)
    }

}
