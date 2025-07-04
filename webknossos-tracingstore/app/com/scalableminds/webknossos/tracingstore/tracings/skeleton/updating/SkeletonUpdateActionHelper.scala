package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits

trait SkeletonUpdateActionHelper extends ProtoGeometryImplicits {

  protected def mapTrees(tracing: SkeletonTracing, treeId: Int, transformTree: Tree => Tree): Seq[Tree] =
    tracing.trees.map((tree: Tree) => if (tree.treeId == treeId) transformTree(tree) else tree)

  protected def treeById(tracing: SkeletonTracing, treeId: Int): Tree =
    tracing.trees
      .find(_.treeId == treeId)
      .getOrElse(throw new NoSuchElementException("Tracing does not contain tree with requested id " + treeId))

  protected def convertBranchPoint(aBranchPoint: UpdateActionBranchPoint): BranchPoint =
    BranchPoint(aBranchPoint.nodeId, aBranchPoint.timestamp)
  protected def convertComment(aComment: UpdateActionComment): Comment =
    Comment(aComment.nodeId, aComment.content)

  protected def convertTreeGroup(aTreeGroup: UpdateActionTreeGroup): TreeGroup =
    TreeGroup(aTreeGroup.name, aTreeGroup.groupId, aTreeGroup.children.map(convertTreeGroup), aTreeGroup.isExpanded)
}
