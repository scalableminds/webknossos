/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.skeleton

import com.scalableminds.braingames.datastore.SkeletonTracing.Tree


object TreeUtils {
  type FunctionalNodeMapping = Function[Int, Int]

  def minNodeId(trees: Seq[Tree]) = {
    val nodes = trees.flatMap(_.nodes)
    if (nodes.isEmpty)
      0
    else
      nodes.map(_.id).min
  }

  def maxNodeId(trees: Seq[Tree]) = {
    val nodes = trees.flatMap(_.nodes)
    if (nodes.isEmpty)
      0
    else
      nodes.map(_.id).max
  }

  def maxTreeId(trees: Seq[Tree]) = {
    if (trees.isEmpty)
      0
    else
      trees.map(_.treeId).max
  }

  def mergeTrees(sourceTrees: Seq[Tree], targetTrees: Seq[Tree], nodeMapping: FunctionalNodeMapping) = {
    val treeMaxId = maxTreeId(targetTrees)

    val mappedSourceTrees = sourceTrees.map(tree =>
      applyNodeMapping(tree.withTreeId(tree.treeId + treeMaxId), nodeMapping))

    targetTrees ++ mappedSourceTrees
  }

  def applyNodeMapping(tree: Tree, f: Int => Int) = {
    tree
      .withNodes(tree.nodes.map(node => node.withId(f(node.id))))
      .withEdges(tree.edges.map(edge => edge.withSource(f(edge.source)).withTarget(f(edge.target))))
      .withComments(tree.comments.map(comment => comment.withNodeId(f(comment.nodeId))))
      .withBranchPoints(tree.branchPoints.map(bp => bp.withNodeId(f(bp.nodeId))))
  }

  def calculateNodeMapping(sourceTrees: Seq[Tree], targetTrees: Seq[Tree]) = {
    val nodeIdOffset = calculateNodeOffset(sourceTrees, targetTrees)
    (nodeId: Int) => nodeId + nodeIdOffset
  }

  def calculateNodeOffset(sourceTrees: Seq[Tree], targetTrees: Seq[Tree]) = {
    if (targetTrees.isEmpty)
      0
    else {
      val targetNodeMaxId = maxNodeId(targetTrees)
      val sourceNodeMinId = minNodeId(sourceTrees)
      math.max(targetNodeMaxId + 1 - sourceNodeMinId, 0)
    }
  }

  def subtract(t1: Tree, t2: Tree) = {
    t1.withNodes((t1.nodes.toSet -- t2.nodes.toSet).toSeq).withEdges((t1.edges.toSet -- t2.edges.toSet).toSeq)
  }

  def add(t1: Tree, t2: Tree) = {
    t1.withNodes(t1.nodes ++ t2.nodes).withEdges(t1.edges ++ t2.edges)
  }
}
