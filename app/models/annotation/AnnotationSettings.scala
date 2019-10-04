package models.annotation

import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import models.annotation.AnnotationSettings._
import play.api.data.validation.ValidationError
import play.api.libs.json._

case class AnnotationSettings(
    allowedModes: List[String] = SKELETON_MODES,
    preferredMode: Option[String] = None,
    branchPointsAllowed: Boolean = true,
    somaClickingAllowed: Boolean = true,
    mergerMode: Boolean = false,
    allowedMagnifications: Option[JsValue] = None
)

object AnnotationSettings {
  val ORTHOGONAL = "orthogonal"
  val OBLIQUE = "oblique"
  val FLIGHT = "flight"
  val VOLUME = "volume"

  val SKELETON_MODES = List(ORTHOGONAL, OBLIQUE, FLIGHT)
  val VOLUME_MODES = List(VOLUME)
  val ALL_MODES = SKELETON_MODES ::: VOLUME_MODES

  def defaultFor(tracingType: TracingType.Value) = tracingType match {
    case TracingType.skeleton =>
      AnnotationSettings(allowedModes = SKELETON_MODES)
    case TracingType.volume =>
      AnnotationSettings(allowedModes = VOLUME_MODES)
    case TracingType.hybrid =>
      AnnotationSettings(allowedModes = ALL_MODES)
  }

  implicit val annotationSettingsWrites = Json.writes[AnnotationSettings]

  implicit val annotationSettingsReads =
    Json
      .reads[AnnotationSettings]
      .filter(JsonValidationError("annotation.preferedMode.invalid")) { a =>
        a.preferredMode.forall(ALL_MODES.contains)
      }
      .filter(JsonValidationError("annotation.mode.invalid")) { a =>
        a.allowedModes.forall(ALL_MODES.contains)
      }
}
