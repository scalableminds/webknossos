package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.SkeletonTracing.TreeGroup
import com.scalableminds.webknossos.datastore.VolumeTracing.SegmentGroup

import scala.annotation.tailrec

abstract class TracingItemGroup() {
  def inner: Any // Can be either SegmentItemGroup or TreeItemGroup, with this class acting as an adapter for GroupUtils
  def groupId: Int
  def children: Seq[TracingItemGroup]
  def withGroupId(id: Int): TracingItemGroup
  def withChildren(children: Seq[TracingItemGroup]): TracingItemGroup
}

object GroupUtils {

  type FunctionalGroupMapping = Function[Int, Int]

  def calculateGroupMapping(sourceGroups: Seq[TracingItemGroup], targetGroups: Seq[TracingItemGroup]): Int => Int = {
    val groupIdOffset = calculateGroupIdOffset(sourceGroups, targetGroups)
    (groupId: Int) =>
      groupId + groupIdOffset
  }

  def maxGroupIdRecursive(groups: Seq[TracingItemGroup]): Int =
    if (groups.isEmpty) 0 else (groups.map(_.groupId) ++ groups.map(g => maxGroupIdRecursive(g.children))).max

  def minGroupIdRecursive(groups: Seq[TracingItemGroup]): Int =
    if (groups.isEmpty) Int.MaxValue
    else (groups.map(_.groupId) ++ groups.map(g => minGroupIdRecursive(g.children))).min

  private def calculateGroupIdOffset(sourceGroups: Seq[TracingItemGroup], targetGroups: Seq[TracingItemGroup]) =
    if (targetGroups.isEmpty)
      0
    else {
      val targetGroupMaxId = if (targetGroups.isEmpty) 0 else maxGroupIdRecursive(targetGroups)
      val sourceGroupMinId = if (sourceGroups.isEmpty) 0 else minGroupIdRecursive(sourceGroups)
      math.max(targetGroupMaxId + 1 - sourceGroupMinId, 0)
    }

  def mergeGroups(sourceGroups: Seq[TracingItemGroup],
                  targetGroups: Seq[TracingItemGroup],
                  groupMapping: FunctionalGroupMapping): Seq[TracingItemGroup] = {
    def applyGroupMappingRecursive(groups: Seq[TracingItemGroup]): Seq[TracingItemGroup] =
      groups.map(group =>
        group.withGroupId(groupMapping(group.groupId)).withChildren(applyGroupMappingRecursive(group.children)))

    applyGroupMappingRecursive(sourceGroups) ++ targetGroups
  }

  def getAllChildrenGroups(rootGroup: TracingItemGroup): Seq[TracingItemGroup] = {
    def childIter(currentGroup: Seq[TracingItemGroup]): Seq[TracingItemGroup] =
      currentGroup match {
        case Seq() => Seq.empty
        case _     => currentGroup ++ currentGroup.flatMap(group => childIter(group.children))
      }

    childIter(Seq(rootGroup))
  }

  @tailrec
  final def getAllGroupIds(tracingItemGroups: Seq[TracingItemGroup], ids: Seq[Int] = Seq[Int]()): Seq[Int] =
    tracingItemGroups match {
      case head :: tail => getAllGroupIds(tail ++ head.children, head.groupId +: ids)
      case _            => ids
    }

  def calculateTreeGroupMapping(sourceGroups: Seq[TreeGroup], targetGroups: Seq[TreeGroup]): FunctionalGroupMapping =
    calculateGroupMapping(sourceGroups.map(tg => new TreeItemGroup(tg)), targetGroups.map(tg => new TreeItemGroup(tg)))

  def calculateSegmentGroupMapping(sourceGroups: Seq[SegmentGroup],
                                   targetGroups: Seq[SegmentGroup]): FunctionalGroupMapping =
    calculateGroupMapping(sourceGroups.map(sg => new SegmentItemGroup(sg)),
                          targetGroups.map(sg => new SegmentItemGroup(sg)))

  def mergeTreeGroups(sourceGroups: Seq[TreeGroup],
                      targetGroups: Seq[TreeGroup],
                      groupMapping: FunctionalGroupMapping): Seq[TreeGroup] =
    mergeGroups(sourceGroups.map(tg => new TreeItemGroup(tg)),
                targetGroups.map(tg => new TreeItemGroup(tg)),
                groupMapping).map(tig => tig.inner.asInstanceOf[TreeGroup])

  def mergeSegmentGroups(sourceGroups: Seq[SegmentGroup],
                         targetGroups: Seq[SegmentGroup],
                         groupMapping: FunctionalGroupMapping): Seq[SegmentGroup] =
    mergeGroups(sourceGroups.map(tg => new SegmentItemGroup(tg)),
                targetGroups.map(tg => new SegmentItemGroup(tg)),
                groupMapping).map(tig => tig.inner.asInstanceOf[SegmentGroup])

  def getAllTreeGroupIds(treeGroups: Seq[TreeGroup], ids: Seq[Int] = Seq[Int]()): Seq[Int] =
    treeGroups.map(t => new TreeItemGroup(t)) match {
      case head :: tail => getAllGroupIds(tail ++ head.children, head.groupId +: ids)
      case _            => ids
    }

  def getAllChildrenTreeGroups(rootGroup: TreeGroup): Seq[TreeGroup] =
    getAllChildrenGroups(new TreeItemGroup(rootGroup)).map((tg: TracingItemGroup) => tg.inner.asInstanceOf[TreeGroup])

  def getAllChildrenSegmentGroups(rootGroup: SegmentGroup): Seq[SegmentGroup] =
    getAllChildrenGroups(new SegmentItemGroup(rootGroup)).map((tg: TracingItemGroup) =>
      tg.inner.asInstanceOf[SegmentGroup])

}

class SegmentItemGroup(segmentGroup: SegmentGroup) extends TracingItemGroup {
  override def inner: SegmentGroup = segmentGroup

  override def groupId: Int = segmentGroup.groupId

  override def children: Seq[TracingItemGroup] = segmentGroup.children.map(s => new SegmentItemGroup(s))

  override def withGroupId(id: Int): TracingItemGroup = new SegmentItemGroup(segmentGroup.withGroupId(id))

  override def withChildren(children: Seq[TracingItemGroup]): TracingItemGroup =
    new SegmentItemGroup(segmentGroup.withChildren(children.map(c => c.inner.asInstanceOf[SegmentGroup])))
}

class TreeItemGroup(treeGroup: TreeGroup) extends TracingItemGroup {
  override def inner: TreeGroup = treeGroup

  override def groupId: Int = treeGroup.groupId

  override def children: Seq[TracingItemGroup] = treeGroup.children.map(s => new TreeItemGroup(s))

  override def withGroupId(id: Int): TracingItemGroup = new TreeItemGroup(treeGroup.withGroupId(id))

  override def withChildren(children: Seq[TracingItemGroup]): TracingItemGroup =
    new TreeItemGroup(treeGroup.withChildren(children.map(c => c.inner.asInstanceOf[TreeGroup])))
}
