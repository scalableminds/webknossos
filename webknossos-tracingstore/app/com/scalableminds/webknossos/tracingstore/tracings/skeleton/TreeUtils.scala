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

  def mergeTrees(treesA: Seq[Tree],
                 treesB: Seq[Tree],
                 treeIdMapA: Map[Int, Int],
                 treeIdMapB: Map[Int, Int],
                 nodeMappingA: FunctionalNodeMapping,
                 groupMappingA: FunctionalGroupMapping): Seq[Tree] = {
    val nodeIdsA: Set[Int] = treesA.flatMap(_.nodes.map(_.id)).toSet

    val mappedTreesA = treesA.map(
      tree =>
        applyNodeMapping(tree.withTreeId(treeIdMapA(tree.treeId)), nodeMappingA, nodeIdsA)
          .copy(groupId = tree.groupId.map(groupMappingA(_))))

    val mappedTreesB = treesB.map(tree => tree.withTreeId(treeIdMapB(tree.treeId)))

    mappedTreesB ++ mappedTreesA
  }

  private def applyNodeMapping(tree: Tree, nodeMappingA: FunctionalNodeMapping, nodeIdsA: Set[Int]) =
    tree
      .withNodes(tree.nodes.map(node => node.withId(nodeMappingA(node.id))))
      .withEdges(tree.edges.map(edge =>
        edge.withSource(nodeMappingA(edge.source)).withTarget(nodeMappingA(edge.target))))
      .withComments(
        tree.comments.map(
          comment =>
            comment
              .withNodeId(nodeMappingA(comment.nodeId))
              .withContent(updateNodeReferences(comment.content, nodeMappingA, nodeIdsA))))
      .withBranchPoints(tree.branchPoints.map(bp => bp.withNodeId(nodeMappingA(bp.nodeId))))

  private def updateNodeReferences(comment: String, nodeMappingA: FunctionalNodeMapping, nodeIdsA: Set[Int]) = {
    def replacer(m: Match) = {
      val oldId = m.toString.substring(1).toInt
      val newId = if (nodeIdsA.contains(oldId)) nodeMappingA(oldId) else oldId
      "#" + newId
    }
    nodeIdReferenceRegex.replaceAllIn(comment, m => replacer(m))
  }

  def calculateNodeMapping(treesA: Seq[Tree], treesB: Seq[Tree]): Int => Int = {
    val nodeIdOffset = calculateNodeOffset(treesA, treesB)
    (nodeId: Int) =>
      nodeId + nodeIdOffset
  }

  def calculateTreeMappings(treesA: Seq[Tree], treesB: Seq[Tree]): (TreeIdMap, TreeIdMap) =
    (calculateTreeMapping(treesA, treesB.length), calculateTreeMapping(treesB, 0))

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

  private def calculateNodeOffset(treesA: Seq[Tree], treesB: Seq[Tree]) =
    if (treesB.isEmpty)
      0
    else {
      val nodeMaxIdB = maxNodeId(treesB)
      val nodeMinIdA = minNodeId(treesA)
      math.max(nodeMaxIdB + 1 - nodeMinIdA, 0)
    }

}
