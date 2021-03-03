package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.geometry.Color

trait SkeletonUpdateActionHelper {

  protected def mapTrees(tracing: SkeletonTracing, treeId: Int, transformTree: Tree => Tree): Seq[Tree] =
    tracing.trees.map((tree: Tree) => if (tree.treeId == treeId) transformTree(tree) else tree)

  protected def mapAllTrees(tracing: SkeletonTracing, transformTree: Tree => Tree): Seq[Tree] =
    tracing.trees.map(transformTree)

  protected def treeById(tracing: SkeletonTracing, treeId: Int): Tree =
    tracing.trees
      .find(_.treeId == treeId)
      .getOrElse(throw new NoSuchElementException("Tracing does not contain tree with requested id " + treeId))

  protected def convertColor(aColor: com.scalableminds.util.image.Color): Color =
    Color(aColor.r, aColor.g, aColor.b, aColor.a)
  protected def convertBranchPoint(aBranchPoint: UpdateActionBranchPoint): BranchPoint =
    BranchPoint(aBranchPoint.nodeId, aBranchPoint.timestamp)
  protected def convertComment(aComment: UpdateActionComment): Comment =
    Comment(aComment.nodeId, aComment.content)
  protected def convertColorOpt(aColorOpt: Option[com.scalableminds.util.image.Color]): Option[Color] =
    aColorOpt match {
      case Some(aColor) => Some(convertColor(aColor))
      case None         => None
    }
  protected def convertTreeGroup(aTreeGroup: UpdateActionTreeGroup): TreeGroup =
    TreeGroup(aTreeGroup.name, aTreeGroup.groupId, aTreeGroup.children.map(convertTreeGroup))
}
