/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.skeleton.updating

import com.scalableminds.braingames.datastore.SkeletonTracing._


trait SkeletonUpdateActionHelper {

  protected def mapTrees(tracing: SkeletonTracing, treeId: Int, transformTree: Tree => Tree): Seq[Tree] = {
    tracing.trees.map((tree: Tree) => if (tree.treeId == treeId) transformTree(tree) else tree)
  }

  protected def treeById(tracing: SkeletonTracing, treeId: Int) =
    tracing.trees.find(_.treeId == treeId)
      .getOrElse(throw new NoSuchElementException("Tracing does not contain tree with requested id " + treeId))

  protected def convertColor(aColor: com.scalableminds.util.image.Color) =
    Color(aColor.r, aColor.g, aColor.b, aColor.a)
  protected def convertBranchPoint(aBranchPoint: UpdateActionBranchPoint) =
    BranchPoint(aBranchPoint.nodeId, aBranchPoint.timestamp)
  protected def convertComment(aComment: UpdateActionComment) =
    Comment(aComment.nodeId, aComment.content)
  protected def convertColorOpt(aColorOpt: Option[com.scalableminds.util.image.Color]) = aColorOpt match {
    case Some(aColor) => Some(convertColor(aColor))
    case None => None
  }
}