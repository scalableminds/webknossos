package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.scalableminds.webknossos.datastore.SkeletonTracing.Tree

import scala.util.matching.Regex
import scala.util.matching.Regex.Match

// Merge convention: tracing A’s node/tree ids are left untouched. Tracing B’s are offset to continue right after A’s.
// For tree ids, B’s are also densified because sparse tree ids exist in the context of agglomerate trees.
object TreeUtils {
  private type FunctionalNodeMapping = Function[Int, Int]
  private type FunctionalGroupMapping = Function[Int, Int]
  type TreeIdMap = Map[Int, Int]

  private val nodeIdReferenceRegex: Regex = "#([0-9]+)" r

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

  private def maxTreeId(trees: Seq[Tree]): Int = trees.map(_.treeId).maxOption.getOrElse(0)

  def mergeTrees(
      treesA: Seq[Tree],
      treesB: Seq[Tree],
      treeIdMapB: Map[Int, Int],
      nodeMappingB: FunctionalNodeMapping,
      groupMappingB: FunctionalGroupMapping
  ): Seq[Tree] = {
    val nodeIdsB: Set[Int] = treesB.flatMap(_.nodes.map(_.id)).toSet

    val mappedTreesB = treesB.map(tree =>
      applyNodeMapping(tree.withTreeId(treeIdMapB(tree.treeId)), nodeMappingB, nodeIdsB)
        .copy(groupId = tree.groupId.map(groupMappingB(_)))
    )

    treesA ++ mappedTreesB
  }

  private def applyNodeMapping(tree: Tree, nodeMappingB: FunctionalNodeMapping, nodeIdsB: Set[Int]) =
    tree
      .withNodes(tree.nodes.map(node => node.withId(nodeMappingB(node.id))))
      .withEdges(
        tree.edges.map(edge => edge.withSource(nodeMappingB(edge.source)).withTarget(nodeMappingB(edge.target)))
      )
      .withComments(
        tree.comments.map(comment =>
          comment
            .withNodeId(nodeMappingB(comment.nodeId))
            .withContent(updateNodeReferences(comment.content, nodeMappingB, nodeIdsB))
        )
      )
      .withBranchPoints(tree.branchPoints.map(bp => bp.withNodeId(nodeMappingB(bp.nodeId))))

  private def updateNodeReferences(comment: String, nodeMappingB: FunctionalNodeMapping, nodeIdsB: Set[Int]) = {
    def replacer(m: Match) = {
      val oldId = m.toString.substring(1).toInt
      val newId = if (nodeIdsB.contains(oldId)) nodeMappingB(oldId) else oldId
      "#" + newId
    }
    nodeIdReferenceRegex.replaceAllIn(comment, m => replacer(m))
  }

  def calculateNodeMapping(treesA: Seq[Tree], treesB: Seq[Tree]): Int => Int = {
    val nodeIdOffset = calculateNodeOffset(treesA, treesB)
    (nodeId: Int) => nodeId + nodeIdOffset
  }

  // A’s tree ids are kept, B’s are densified and offset to continue right after A’s.
  def calculateTreeMapping(treesA: Seq[Tree], treesB: Seq[Tree]): TreeIdMap =
    densifyTreeIds(treesB, maxTreeId(treesA))

  // We’re densifying the tree ids to avoid sparse ids growing too fast
  private def densifyTreeIds(trees: Seq[Tree], offset: Int): Map[Int, Int] =
    trees
      .map(_.treeId)
      .sorted
      .zipWithIndex
      .map { case (treeId, index) =>
        (treeId, index + 1 + offset)
      }
      .toMap

  // When merging two skeletons, the node ids of skeleton B are remapped by adding this offset
  // to keep everything unique, continuing right after skeleton A’s node ids.
  // If the existing nodes of B don’t start at 0, their start is subtracted, densifying the ids.
  private def calculateNodeOffset(treesA: Seq[Tree], treesB: Seq[Tree]) =
    if (treesB.isEmpty)
      0
    else {
      val nodeMaxIdA = maxNodeId(treesA)
      val nodeMinIdB = minNodeId(treesB)
      math.max(nodeMaxIdA + 1 - nodeMinIdB, 0)
    }

}
