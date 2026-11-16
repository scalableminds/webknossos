package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Tree, TreeTypeProto}
import com.scalableminds.webknossos.tracingstore.annotation.{TSAnnotationService, UpdateAction, UpdateActionGroup}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.*
import play.api.http.Status.FORBIDDEN

import scala.concurrent.ExecutionContext

object TreeOwnership {

  // Value of CollaborationMode.Concurrent as sent by webknossos in the UserAccessAnswer
  val concurrentCollaborationMode: String = "Concurrent"

  // Ids of the trees an action edits. Empty for actions that are not owner-restricted
  // (createTree, user-state actions, updateTreeGroups, non-skeleton actions).
  def editedTreeIds(action: UpdateAction): Seq[Int] = action match {
    case a: UpdateTreeSkeletonAction                => a.id +: a.updatedId.toSeq
    case a: DeleteTreeSkeletonAction                => Seq(a.id)
    case a: MergeTreeSkeletonAction                 => Seq(a.sourceId, a.targetId)
    case a: MoveTreeComponentSkeletonAction         => Seq(a.sourceId, a.targetId)
    case a: CreateNodeSkeletonAction                => Seq(a.treeId)
    case a: UpdateNodeSkeletonAction                => Seq(a.treeId)
    case a: DeleteNodeSkeletonAction                => Seq(a.treeId)
    case a: CreateEdgeSkeletonAction                => Seq(a.treeId)
    case a: DeleteEdgeSkeletonAction                => Seq(a.treeId)
    case a: UpdateTreeEdgesVisibilitySkeletonAction => Seq(a.treeId)
    case _                                          => Seq.empty
  }

  // Tracing ids of the skeletons that the actions edit trees in
  def tracingIdsWithEditedTrees(actions: Seq[UpdateAction]): Seq[String] =
    actions.collect {
      case a: SkeletonUpdateAction if editedTreeIds(a).nonEmpty => a.actionTracingId
    }.distinct

  /* Returns the ids of trees that the actions edit, but that the requesting user may not edit.
   * actions must all belong to the skeleton tracing that trees are from.
   * Trees without ownerId belong to the annotation owner. Agglomerate trees may be edited by anyone.
   * Tree ids missing in trees (e.g. created earlier in the same transaction) are allowed. */
  def findForeignTreeIds(
      trees: Seq[Tree],
      annotationOwnerId: ObjectId,
      requestingUserId: ObjectId,
      actions: Seq[UpdateAction]
  ): Seq[Int] = {
    val treesById = trees.map(t => t.treeId -> t).toMap
    def isForeign(treeId: Int): Boolean = treesById.get(treeId).exists { tree =>
      val isAgglomerate = tree.`type`.contains(TreeTypeProto.AGGLOMERATE)
      val ownerId = tree.ownerId.getOrElse(annotationOwnerId.toString)
      !isAgglomerate && ownerId != requestingUserId.toString
    }
    actions.flatMap(editedTreeIds).distinct.filter(isForeign)
  }
}

class TreeOwnershipService @Inject() (annotationService: TSAnnotationService) {

  // Called before storing update groups. Not checked when applying updates, as those are applied lazily on read
  // and a failure there would break the annotation permanently.
  def assertOnlyOwnTreesEdited(
      annotationId: ObjectId,
      updateGroups: Seq[UpdateActionGroup],
      collaborationModeOpt: Option[String],
      annotationOwnerIdOpt: Option[ObjectId],
      requestingUserIdOpt: Option[ObjectId]
  )(using tc: TokenContext, ec: ExecutionContext): Fox[Unit] =
    (collaborationModeOpt, annotationOwnerIdOpt, requestingUserIdOpt) match {
      case (Some(TreeOwnership.concurrentCollaborationMode), Some(annotationOwnerId), Some(requestingUserId)) =>
        val actions = updateGroups.flatMap(_.actions)
        val tracingIds = TreeOwnership.tracingIdsWithEditedTrees(actions)
        for {
          annotationProtoOpt <- Fox.runIf(tracingIds.nonEmpty)(annotationService.get(annotationId, None))
          // Skeletons added in the same request don't exist yet, all their trees are new
          storedTracingIds = annotationProtoOpt.toSeq.flatMap(_.annotationLayers.map(_.tracingId)).toSet
          foreignTreeIdsPerTracing <- Fox.serialCombined(tracingIds.filter(storedTracingIds.contains)) { tracingId =>
            for {
              skeleton <- annotationService.findSkeleton(annotationId, tracingId)
              actionsOfTracing = actions.filter {
                case a: SkeletonUpdateAction => a.actionTracingId == tracingId
                case _                       => false
              }
            } yield TreeOwnership.findForeignTreeIds(
              skeleton.trees,
              annotationOwnerId,
              requestingUserId,
              actionsOfTracing
            )
          }
          foreignTreeIds = foreignTreeIdsPerTracing.flatten
          _ <- Fox.fromBool(foreignTreeIds.isEmpty) ?~> Msg.Annotation.ApplyUpdate.foreignTreeEdit(
            foreignTreeIds
          ) ~> FORBIDDEN
        } yield ()
      case _ => Fox.successful(())
    }
}
