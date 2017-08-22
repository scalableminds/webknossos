/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.skeleton

import com.scalableminds.braingames.datastore.tracings.skeleton.elements.Tree


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

  def maxTreeId(trees: List[Tree]) = {
    if (trees.isEmpty)
      0
    else
      trees.map(_.treeId).max
  }

  def mergeTrees(sourceTrees: List[Tree], targetTrees: List[Tree], nodeMapping: FunctionalNodeMapping) = {
    val treeMaxId = maxTreeId(targetTrees)

    val mappedSourceTrees = sourceTrees.map(tree =>
      tree.changeTreeId(tree.treeId + treeMaxId).applyNodeMapping(nodeMapping))

    targetTrees ::: mappedSourceTrees
  }

  def calculateNodeMapping(sourceTrees: List[Tree], targetTrees: List[Tree]) = {
    val nodeIdOffset = calculateNodeOffset(sourceTrees, targetTrees)
    (nodeId: Int) => nodeId + nodeIdOffset
  }

  def calculateNodeOffset(sourceTrees: List[Tree], targetTrees: List[Tree]) = {
    if (targetTrees.isEmpty)
      0
    else {
      val targetNodeMaxId = maxNodeId(targetTrees)
      val sourceNodeMinId = minNodeId(sourceTrees)
      math.max(targetNodeMaxId + 1 - sourceNodeMinId, 0)
    }
  }
}
