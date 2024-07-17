package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.Annotation.{
  AddLayerAnnotationUpdateAction,
  AnnotationLayerProto,
  AnnotationProto,
  DeleteLayerAnnotationUpdateAction,
  UpdateLayerMetadataAnnotationUpdateAction,
  UpdateMetadataAnnotationUpdateAction
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.UpdateBucketVolumeAction
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, TracingDataStore}
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingUpdatesReport}
import scalapb.GeneratedMessage

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DSAnnotationService @Inject()(remoteWebknossosClient: TSRemoteWebknossosClient,
                                    tracingDataStore: TracingDataStore)
    extends KeyValueStoreImplicits {

  def reportUpdates(annotationId: String, updateGroups: List[UpdateActionGroup], userToken: Option[String]): Fox[Unit] =
    for {
      _ <- remoteWebknossosClient.reportTracingUpdates(
        TracingUpdatesReport(
          annotationId,
          timestamps = updateGroups.map(g => Instant(g.timestamp)),
          statistics = updateGroups.flatMap(_.stats).lastOption,
          significantChangesCount = updateGroups.map(_.significantChangesCount).sum,
          viewChangesCount = updateGroups.map(_.viewChangesCount).sum,
          userToken
        ))
    } yield ()

  def currentVersion(annotationId: String): Fox[Long] = ???

  def handleUpdateGroup(annotationId: String,
                        updateActionGroup: UpdateActionGroup,
                        previousVersion: Long,
                        userToken: Option[String]): Fox[Unit] =
    // TODO apply some updates directly? transform to compact?
    tracingDataStore.annotationUpdates.put(annotationId,
                                           updateActionGroup.version,
                                           preprocessActionsForStorage(updateActionGroup))

  private def preprocessActionsForStorage(updateActionGroup: UpdateActionGroup): List[UpdateAction] = {
    val actionsWithInfo = updateActionGroup.actions.map(
      _.addTimestamp(updateActionGroup.timestamp).addAuthorId(updateActionGroup.authorId)) match {
      case Nil => List[UpdateAction]()
      //to the first action in the group, attach the group's info
      case first :: rest => first.addInfo(updateActionGroup.info) :: rest
    }
    actionsWithInfo.map {
      case a: UpdateBucketVolumeAction => a.transformToCompact // TODO or not?
      case a                           => a
    }
  }

  def applyUpdate(annotation: AnnotationProto, updateAction: GeneratedMessage)(
      implicit ec: ExecutionContext): Fox[AnnotationProto] =
    for {

      withAppliedChange <- updateAction match {
        case a: AddLayerAnnotationUpdateAction =>
          Fox.successful(
            annotation.copy(layers = annotation.layers :+ AnnotationLayerProto(a.tracingId, a.name, `type` = a.`type`)))
        case a: DeleteLayerAnnotationUpdateAction =>
          Fox.successful(annotation.copy(layers = annotation.layers.filter(_.tracingId != a.tracingId)))
        case a: UpdateLayerMetadataAnnotationUpdateAction =>
          Fox.successful(annotation.copy(layers = annotation.layers.map(l =>
            if (l.tracingId == a.tracingId) l.copy(name = a.name) else l)))
        case a: UpdateMetadataAnnotationUpdateAction =>
          Fox.successful(annotation.copy(name = a.name, description = a.description))
        case _ => Fox.failure("Received unsupported AnnotationUpdaetAction action")
      }
    } yield withAppliedChange.copy(version = withAppliedChange.version + 1L)

}
