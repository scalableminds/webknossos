package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.Annotation.{
  AddLayerAnnotationUpdateAction,
  AnnotationLayerProto,
  AnnotationProto,
  DeleteLayerAnnotationUpdateAction,
  UpdateLayerAnnotationUpdateAction,
  UpdateLayerEditableMappingAnnotationUpdateAction,
  UpdateLayerMetadataAnnotationUpdateAction,
  UpdateMetadataAnnotationUpdateAction
}
import scalapb.GeneratedMessage

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DSAnnotationService @Inject()() {
  def storeUpdate(updateAction: GeneratedMessage)(implicit ec: ExecutionContext): Fox[Unit] = Fox.successful(())

  def applyUpdate(annotation: AnnotationProto, updateAction: GeneratedMessage): AnnotationProto = {

    val withAppliedChange = updateAction match {
      case a: AddLayerAnnotationUpdateAction =>
        annotation.copy(
          layers = annotation.layers :+ AnnotationLayerProto(a.tracingId,
                                                             a.name,
                                                             version = 0L,
                                                             editableMappingVersion = None,
                                                             `type` = a.`type`))
      case a: DeleteLayerAnnotationUpdateAction =>
        annotation.copy(layers = annotation.layers.filter(_.tracingId != a.tracingId))
      case a: UpdateLayerAnnotationUpdateAction =>
        annotation.copy(
          layers = annotation.layers.map(l => if (l.tracingId == a.tracingId) l.copy(version = a.layerVersion) else l))
      case a: UpdateLayerEditableMappingAnnotationUpdateAction =>
        annotation.copy(layers = annotation.layers.map(l =>
          if (l.tracingId == a.tracingId) l.copy(editableMappingVersion = Some(a.editableMappingVersion)) else l))
      case a: UpdateLayerMetadataAnnotationUpdateAction =>
        annotation.copy(
          layers = annotation.layers.map(l => if (l.tracingId == a.tracingId) l.copy(name = a.name) else l))
      case a: UpdateMetadataAnnotationUpdateAction =>
        annotation.copy(name = a.name, description = a.description)
      // TODO error case

    }
    withAppliedChange.copy(version = withAppliedChange.version + 1L)
  }

}
