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
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingUpdatesReport}
import scalapb.GeneratedMessage

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DSAnnotationService @Inject()(remoteWebknossosClient: TSRemoteWebknossosClient) {
  def storeUpdate(updateAction: GeneratedMessage)(implicit ec: ExecutionContext): Fox[Unit] = Fox.successful(())

  def reportUpdates(annotationId: String,
                    updateGroups: List[GenericUpdateActionGroup],
                    userToken: Option[String]): Fox[Unit] =
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
                        updateGroup: GenericUpdateActionGroup,
                        previousVersion: Long,
                        userToken: Option[String]): Fox[Unit] = ???

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
