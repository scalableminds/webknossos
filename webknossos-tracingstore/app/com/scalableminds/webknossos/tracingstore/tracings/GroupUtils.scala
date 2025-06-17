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

  private def calculateGroupMapping(groupsA: Seq[TracingItemGroup], groupsB: Seq[TracingItemGroup]): Int => Int = {
    val groupIdOffset = calculateGroupIdOffset(groupsA, groupsB)
    (groupId: Int) =>
      groupId + groupIdOffset
  }

  private def maxGroupIdRecursive(groups: Seq[TracingItemGroup]): Int =
    if (groups.isEmpty) 0 else (groups.map(_.groupId) ++ groups.map(g => maxGroupIdRecursive(g.children))).max

  private def minGroupIdRecursive(groups: Seq[TracingItemGroup]): Int =
    if (groups.isEmpty) Int.MaxValue
    else (groups.map(_.groupId) ++ groups.map(g => minGroupIdRecursive(g.children))).min

  private def calculateGroupIdOffset(groupsA: Seq[TracingItemGroup], groupsB: Seq[TracingItemGroup]) =
    if (groupsB.isEmpty)
      0
    else {
      val targetGroupMaxId = if (groupsB.isEmpty) 0 else maxGroupIdRecursive(groupsB)
      val sourceGroupMinId = if (groupsA.isEmpty) 0 else minGroupIdRecursive(groupsA)
      math.max(targetGroupMaxId + 1 - sourceGroupMinId, 0)
    }

  private def mergeGroups(groupsA: Seq[TracingItemGroup],
                          groupsB: Seq[TracingItemGroup],
                          groupMappingA: FunctionalGroupMapping): Seq[TracingItemGroup] = {
    def applyGroupMappingRecursive(groups: Seq[TracingItemGroup]): Seq[TracingItemGroup] =
      groups.map(group =>
        group.withGroupId(groupMappingA(group.groupId)).withChildren(applyGroupMappingRecursive(group.children)))

    applyGroupMappingRecursive(groupsA) ++ groupsB
  }

  private def getAllChildrenGroups(rootGroup: TracingItemGroup): Seq[TracingItemGroup] = {
    def childIter(currentGroup: Seq[TracingItemGroup]): Seq[TracingItemGroup] =
      currentGroup match {
        case Seq() => Seq.empty
        case _     => currentGroup ++ currentGroup.flatMap(group => childIter(group.children))
      }

    childIter(Seq(rootGroup))
  }

  @tailrec
  final private def getAllGroupIds(tracingItemGroups: Seq[TracingItemGroup], ids: Seq[Int]): Seq[Int] =
    tracingItemGroups match {
      case head :: tail => getAllGroupIds(tail ++ head.children, head.groupId +: ids)
      case _            => ids
    }

  def calculateTreeGroupMapping(groupsA: Seq[TreeGroup], groupsB: Seq[TreeGroup]): FunctionalGroupMapping =
    calculateGroupMapping(groupsA.map(tg => new TreeItemGroup(tg)), groupsB.map(tg => new TreeItemGroup(tg)))

  def calculateSegmentGroupMapping(groupsA: Seq[SegmentGroup], groupsB: Seq[SegmentGroup]): FunctionalGroupMapping =
    calculateGroupMapping(groupsA.map(sg => new SegmentItemGroup(sg)), groupsB.map(sg => new SegmentItemGroup(sg)))

  def mergeTreeGroups(groupsA: Seq[TreeGroup],
                      groupsB: Seq[TreeGroup],
                      groupMappingA: FunctionalGroupMapping): Seq[TreeGroup] =
    mergeGroups(groupsA.map(tg => new TreeItemGroup(tg)), groupsB.map(tg => new TreeItemGroup(tg)), groupMappingA)
      .map(tig => tig.inner.asInstanceOf[TreeGroup])

  def mergeSegmentGroups(groupsA: Seq[SegmentGroup],
                         groupsB: Seq[SegmentGroup],
                         groupMappingA: FunctionalGroupMapping): Seq[SegmentGroup] =
    mergeGroups(groupsA.map(tg => new SegmentItemGroup(tg)), groupsB.map(tg => new SegmentItemGroup(tg)), groupMappingA)
      .map(tig => tig.inner.asInstanceOf[SegmentGroup])

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
