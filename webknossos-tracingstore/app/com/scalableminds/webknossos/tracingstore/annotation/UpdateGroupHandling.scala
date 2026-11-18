package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.Msg
import com.scalableminds.util.box.{Box, Full}
import com.scalableminds.util.collections.SequenceUtils
import com.scalableminds.webknossos.tracingstore.tracings.volume.UpdateBucketPartialVolumeAction
import com.typesafe.scalalogging.LazyLogging

object UpdateGroupHandling {

  // Actions that need to be the only update in their respective update group. Reused both by the
  // replay-time regrouping below (which assumes this already holds) and by AnnotationTransactionService,
  // which asserts it at commit time.
  def isIsolationSensitiveAction(a: UpdateAction): Boolean = a match {
    case _: RevertToVersionAnnotationAction => true
    case _: AddLayerAnnotationAction        => true
    case _: ResetToBaseAnnotationAction     => true
    case _                                  => false
  }

  // Caps the buckets a VolumeBucketBuffer holds while applying one regrouped update group
  // (up to 1 GiB for uint64 buckets of 256 KiB).
  val maxUpdateBucketPartialActionsPerRegroupedGroup = 4096
}

trait UpdateGroupHandling extends LazyLogging {

  /*
   * Regroup update action groups, isolating the update actions that need it.
   * (See UpdateGroupHandling.isIsolationSensitiveAction)
   * Assumes they are already the only update in their respective group.
   * Also stops concatenating once a group has maxUpdateBucketPartialActions updateBucketPartial actions,
   * to bound the memory needed to apply it. Saved groups are never split.
   * Expects groups sorted by version in descending order
   * Outputs (potentially fewer!) groups in ascending order
   * Target versions should be unchanged. Each group's target version is the max of its input.
   * Compare unit test for UpdateGroupHandlingUnitTestSuite
   */
  def reorderAndRegroupByIsolationSensitiveActions(
      updateActionGroupsWithVersions: List[(Long, List[UpdateAction])],
      maxUpdateBucketPartialActions: Int = UpdateGroupHandling.maxUpdateBucketPartialActionsPerRegroupedGroup
  ): Box[List[(Long, List[UpdateAction])]] =
    for {
      groupVersions <- Full(updateActionGroupsWithVersions.map(_._1))
      _ <- Box.fromBool(
        groupVersions.sorted(using Ordering[Long].reverse) == groupVersions
      ) ?~> Msg.Annotation.ApplyUpdate.updateGroupVersionsNotSortedDesc
      splitGroupLists: List[List[(Long, List[UpdateAction])]] = SequenceUtils.splitAndIsolate(
        updateActionGroupsWithVersions.reverse
      )(actionGroup =>
        actionGroup._2.exists(updateAction => UpdateGroupHandling.isIsolationSensitiveAction(updateAction))
      )
      result = splitGroupLists
        .flatMap(groups => splitByUpdateBucketPartialActionCount(groups, maxUpdateBucketPartialActions))
        .flatMap { (groupsToConcatenate: List[(Long, List[UpdateAction])]) =>
          concatenateUpdateActionGroups(groupsToConcatenate)
        }
    } yield result

  // Splits consecutive groups into runs with at most maxCount updateBucketPartial actions each.
  // A single group with more than maxCount stays one run.
  private def splitByUpdateBucketPartialActionCount(
      groups: List[(Long, List[UpdateAction])],
      maxCount: Int
  ): List[List[(Long, List[UpdateAction])]] = {
    def countIn(group: (Long, List[UpdateAction])): Int =
      group._2.count(_.isInstanceOf[UpdateBucketPartialVolumeAction])
    val (runs, currentRun, _) =
      groups.foldLeft((List.empty[List[(Long, List[UpdateAction])]], List.empty[(Long, List[UpdateAction])], 0)) {
        case ((runs, currentRun, currentCount), group) =>
          val groupCount = countIn(group)
          if (currentRun.nonEmpty && groupCount > 0 && currentCount + groupCount > maxCount)
            (currentRun.reverse :: runs, List(group), groupCount)
          else (runs, group :: currentRun, currentCount + groupCount)
      }
    (currentRun.reverse :: runs).filter(_.nonEmpty).reverse
  }

  private def concatenateUpdateActionGroups(
      groups: List[(Long, List[UpdateAction])]
  ): Option[(Long, List[UpdateAction])] = {
    val updates = groups.flatMap(_._2)
    val targetVersionOpt: Option[Long] = groups.map(_._1).lastOption
    targetVersionOpt.map(targetVersion => (targetVersion, updates))
  }

  /*
   * Iron out reverts in a sequence of update groups.
   * Scans for RevertToVersionActions and skips updates as specified by the reverts
   * Expects updateGroups as Version-Seq[UpdateAction] tuples, SORTED DESCENDING by version number
   * Returns a single Seq of UpdateAction, in to-apply order
   * Compare unit test in UpdateGroupHandlingUnitTestSuite
   */
  def ironOutReverts(updateGroups: Seq[(Long, Seq[UpdateAction])]): Seq[UpdateAction] =
    updateGroups.headOption match {
      case None                   => Seq() // no update groups, return no updates
      case Some(firstUpdateGroup) =>
        val (ironedOutGroups: Seq[Seq[UpdateAction]], _) =
          updateGroups.foldLeft[(Seq[Seq[UpdateAction]], Long)]((Seq(), firstUpdateGroup._1)) {
            (collectedAndNextVersion: (Seq[Seq[UpdateAction]], Long), updateGroupWithVersion) =>
              val collected = collectedAndNextVersion._1
              val nextVersion = collectedAndNextVersion._2
              if (updateGroupWithVersion._1 > nextVersion) {
                // We have not yet reached nextVersion. Skip to next element, Do not collect, do not change nextVersion
                (collected, nextVersion)
              } else {
                val revertSourceVersionOpt = revertSourceVersionFromUpdates(updateGroupWithVersion._2)
                revertSourceVersionOpt match {
                  // This group is a revert action. Set nextVersion to revertSourceVersion, do not collect this group
                  case Some(revertSourceVersion) => (collected, revertSourceVersion)
                  // This group is a normal action. Collect it, decrement nextVersion
                  // Note: we *prepend* the update group here, meaning the output will go from oldest to newest version
                  case None => (updateGroupWithVersion._2 +: collected, nextVersion - 1)
                }
              }

          }
        ironedOutGroups.flatten
    }

  private def revertSourceVersionFromUpdates(updates: Seq[UpdateAction]): Option[Long] =
    updates.flatMap {
      case u: RevertToVersionAnnotationAction => Some(u.sourceVersion)
      case _                                  => None
    }.headOption
}
