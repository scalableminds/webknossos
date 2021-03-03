package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.scalableminds.webknossos.datastore.SkeletonTracing.{Tree, TreeGroup}

import scala.util.matching.Regex
import scala.util.matching.Regex.Match

object TreeUtils {
  type FunctionalNodeMapping = Function[Int, Int]
  type FunctionalGroupMapping = Function[Int, Int]

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

  private def maxTreeId(trees: Seq[Tree]) =
    if (trees.isEmpty)
      0
    else
      trees.map(_.treeId).max

  def mergeTrees(sourceTrees: Seq[Tree],
                 targetTrees: Seq[Tree],
                 nodeMapping: FunctionalNodeMapping,
                 groupMapping: FunctionalGroupMapping): Seq[Tree] = {
    val treeMaxId = maxTreeId(targetTrees)

    val sourceNodeIds: Set[Int] = sourceTrees.flatMap(_.nodes.map(_.id)).toSet

    val mappedSourceTrees = sourceTrees.map(
      tree =>
        applyNodeMapping(tree.withTreeId(tree.treeId + treeMaxId), nodeMapping, sourceNodeIds)
          .copy(groupId = tree.groupId.map(groupMapping(_))))

    targetTrees ++ mappedSourceTrees
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

  private def calculateNodeOffset(sourceTrees: Seq[Tree], targetTrees: Seq[Tree]) =
    if (targetTrees.isEmpty)
      0
    else {
      val targetNodeMaxId = maxNodeId(targetTrees)
      val sourceNodeMinId = minNodeId(sourceTrees)
      math.max(targetNodeMaxId + 1 - sourceNodeMinId, 0)
    }

  def calculateGroupMapping(sourceGroups: Seq[TreeGroup], targetGroups: Seq[TreeGroup]): Int => Int = {
    val groupIdOffset = calculateGroupIdOffset(sourceGroups, targetGroups)
    (groupId: Int) =>
      groupId + groupIdOffset
  }

  def maxGroupIdRecursive(groups: Seq[TreeGroup]): Int =
    if (groups.isEmpty) 0 else (groups.map(_.groupId) ++ groups.map(g => maxGroupIdRecursive(g.children))).max

  def minGroupIdRecursive(groups: Seq[TreeGroup]): Int =
    if (groups.isEmpty) Int.MaxValue
    else (groups.map(_.groupId) ++ groups.map(g => minGroupIdRecursive(g.children))).min

  private def calculateGroupIdOffset(sourceGroups: Seq[TreeGroup], targetGroups: Seq[TreeGroup]) =
    if (targetGroups.isEmpty)
      0
    else {
      val targetGroupMaxId = if (targetGroups.isEmpty) 0 else maxGroupIdRecursive(targetGroups)
      val sourceGroupMinId = if (sourceGroups.isEmpty) 0 else minGroupIdRecursive(sourceGroups)
      math.max(targetGroupMaxId + 1 - sourceGroupMinId, 0)
    }

  def mergeGroups(sourceGroups: Seq[TreeGroup], targetGroups: Seq[TreeGroup], groupMapping: FunctionalGroupMapping): Seq[TreeGroup] = {
    def applyGroupMappingRecursive(groups: Seq[TreeGroup]): Seq[TreeGroup] =
      groups.map(group =>
        group.withGroupId(groupMapping(group.groupId)).withChildren(applyGroupMappingRecursive(group.children)))

    applyGroupMappingRecursive(sourceGroups) ++ targetGroups
  }

  def getAllChildrenGroups(rootGroup: TreeGroup): Seq[TreeGroup] = {
    def childIter(currentGroup: Seq[TreeGroup]): Seq[TreeGroup] =
      currentGroup match {
        case Seq() => Seq.empty
        case _     => currentGroup ++ currentGroup.flatMap(group => childIter(group.children))
      }

    childIter(Seq(rootGroup))
  }
}
