package models.annotation

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationLayerType.AnnotationLayerType
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.ExecutionContext

case class AnnotationLayer(
    tracingId: String,
    typ: AnnotationLayerType,
    name: Option[String] = None
) {}

object AnnotationLayer extends FoxImplicits {
  implicit val jsonFormat: OFormat[AnnotationLayer] = Json.format[AnnotationLayer]

  def layersFromIds(skeletonTracingIdOpt: Option[String],
                    volumeTracingIdOpt: Option[String],
                    assertNonEmpty: Boolean = true)(implicit ec: ExecutionContext): Fox[List[AnnotationLayer]] = {
    val annotationLayers: List[AnnotationLayer] = List(
      skeletonTracingIdOpt.map(AnnotationLayer(_, AnnotationLayerType.Skeleton)),
      volumeTracingIdOpt.map(AnnotationLayer(_, AnnotationLayerType.Volume))).flatten
    for {
      _ <- bool2Fox(!assertNonEmpty || annotationLayers.nonEmpty) ?~> "annotation.needsEitherSkeletonOrVolume"
    } yield annotationLayers
  }
}
