package com.scalableminds.webknossos.tracingstore.annotation

import collections.SequenceUtils
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.{Box, Full}

trait UpdateGroupHandling extends LazyLogging {

  /*
   * Regroup update action groups, isolating the update actions that need it.
   * (Currently RevertToVersionAnnotationAction and AddLayerAnnotationAction)
   * Assumes they are already the only update in their respective group.
   * Expects groups sorted by version in descending order
   * Outputs (potentially fewer!) groups in ascending order
   * Target versions should be unchanged. Each group's target version is the max of its input.
   * Compare unit test for UpdateGroupHandlingUnitTestSuite
   */
  def reorderAndRegroupByIsolationSensitiveActions(
      updateActionGroupsWithVersions: List[(Long, List[UpdateAction])]
  ): Box[List[(Long, List[UpdateAction])]] =
    for {
      groupVersions <- Full(updateActionGroupsWithVersions.map(_._1))
      _ <- Box.fromBool(
        groupVersions.sorted(Ordering[Long].reverse) == groupVersions
      ) ?~! "updateGroupVersions.notSortedDesc"
      splitGroupLists: List[List[(Long, List[UpdateAction])]] = SequenceUtils.splitAndIsolate(
        updateActionGroupsWithVersions.reverse
      )(actionGroup => actionGroup._2.exists(updateAction => isIsolationSensitiveAction(updateAction)))
      result = splitGroupLists.flatMap { (groupsToConcatenate: List[(Long, List[UpdateAction])]) =>
        concatenateUpdateActionGroups(groupsToConcatenate)
      }
    } yield result

  private def concatenateUpdateActionGroups(
      groups: List[(Long, List[UpdateAction])]
  ): Option[(Long, List[UpdateAction])] = {
    val updates = groups.flatMap(_._2)
    val targetVersionOpt: Option[Long] = groups.map(_._1).lastOption
    targetVersionOpt.map(targetVersion => (targetVersion, updates))
  }

  private def isIsolationSensitiveAction(a: UpdateAction): Boolean = a match {
    case _: RevertToVersionAnnotationAction => true
    case _: AddLayerAnnotationAction        => true
    case _                                  => false
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
      case None => Seq() // no update groups, return no updates
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
