package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.Annotation.{
  AddLayerAnnotationUpdateAction,
  AnnotationLayerProto,
  AnnotationProto,
  DeleteLayerAnnotationUpdateAction,
  UpdateLayerMetadataAnnotationUpdateAction,
  UpdateMetadataAnnotationUpdateAction
}
import com.scalableminds.webknossos.tracingstore.controllers.GenericUpdateActionGroup
import com.scalableminds.webknossos.tracingstore.tracings.UpdateActionGroup
import scalapb.GeneratedMessage

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DSAnnotationService @Inject()() {
  def storeUpdate(updateAction: GeneratedMessage)(implicit ec: ExecutionContext): Fox[Unit] = Fox.successful(())

  def commitUpdates(tracingId: String,
                    updateGroups: List[GenericUpdateActionGroup],
                    userToken: Option[String]): Fox[Long] = ???

  def newestMaterializableVersion(annotationId: String): Fox[Long] = ???

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
