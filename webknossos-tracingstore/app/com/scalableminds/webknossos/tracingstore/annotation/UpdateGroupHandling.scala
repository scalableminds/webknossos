package com.scalableminds.webknossos.tracingstore.annotation

import collections.SequenceUtils

trait UpdateGroupHandling {

  def regroupByIsolationSensitiveActions(
      updateActionGroupsWithVersions: List[(Long, List[UpdateAction])]): List[(Long, List[UpdateAction])] = {
    val splitGroupLists: List[List[(Long, List[UpdateAction])]] =
      SequenceUtils.splitAndIsolate(updateActionGroupsWithVersions.reverse)(actionGroup =>
        actionGroup._2.exists(updateAction => isIsolationSensitiveAction(updateAction)))
    // TODO assert that the *groups* that contain revert actions contain nothing else
    // TODO test this

    splitGroupLists.flatMap { groupsToConcatenate: List[(Long, List[UpdateAction])] =>
      concatenateUpdateActionGroups(groupsToConcatenate)
    }
  }

  private def concatenateUpdateActionGroups(
      groups: List[(Long, List[UpdateAction])]): Option[(Long, List[UpdateAction])] = {
    val updates = groups.flatMap(_._2)
    val targetVersionOpt: Option[Long] = groups.map(_._1).lastOption
    targetVersionOpt.map(targetVersion => (targetVersion, updates))
  }

  private def isIsolationSensitiveAction(a: UpdateAction): Boolean = a match {
    case _: RevertToVersionAnnotationAction    => true
    case _: AddLayerAnnotationAction => true
    case _                                 => false
  }
}
