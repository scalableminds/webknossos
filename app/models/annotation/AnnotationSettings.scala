package models.annotation

import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.{ResolutionRestrictions, VolumeTracingDownsampling}
import models.annotation.AnnotationSettings._
import models.binary.DataSet
import play.api.libs.json._

object AllowedMagnifications {
  implicit val format: Format[AllowedMagnifications] = Json.format[AllowedMagnifications]
}

case class AnnotationSettings(
    allowedModes: List[String] = SKELETON_MODES,
    preferredMode: Option[String] = None,
    branchPointsAllowed: Boolean = true,
    somaClickingAllowed: Boolean = true,
    mergerMode: Boolean = false,
    allowedMagnifications: Option[AllowedMagnifications] = None
) {
  def resolutionRestrictions: ResolutionRestrictions =
    allowedMagnifications match {
      case None => ResolutionRestrictions.empty
      case Some(allowedMags) =>
        if (allowedMags.shouldRestrict) ResolutionRestrictions(Some(allowedMags.min), Some(allowedMags.max))
        else ResolutionRestrictions.empty
    }
}

object AnnotationSettings {
  val ORTHOGONAL = "orthogonal"
  val OBLIQUE = "oblique"
  val FLIGHT = "flight"
  val VOLUME = "volume"

  val SKELETON_MODES = List(ORTHOGONAL, OBLIQUE, FLIGHT)
  val VOLUME_MODES = List(VOLUME)
  val ALL_MODES: List[String] = SKELETON_MODES ::: VOLUME_MODES

  def defaultFor(tracingType: TracingType.Value): AnnotationSettings = tracingType match {
    case TracingType.skeleton =>
      AnnotationSettings(allowedModes = SKELETON_MODES)
    case TracingType.volume =>
      AnnotationSettings(allowedModes = VOLUME_MODES)
    case TracingType.hybrid =>
      AnnotationSettings(allowedModes = ALL_MODES)
  }

  implicit val annotationSettingsWrites: OWrites[AnnotationSettings] = Json.writes[AnnotationSettings]

  implicit val annotationSettingsReads: Reads[AnnotationSettings] =
    Json
      .reads[AnnotationSettings]
      .filter(JsonValidationError("annotation.preferedMode.invalid")) { a =>
        a.preferredMode.forall(ALL_MODES.contains)
      }
      .filter(JsonValidationError("annotation.mode.invalid")) { a =>
        a.allowedModes.forall(ALL_MODES.contains)
      }
}

case class AllowedMagnifications(
    shouldRestrict: Boolean,
    min: Int,
    max: Int
) {
  def toQueryString: String =
    if (shouldRestrict)
      s"minResolution=$min&maxResolution=$max"
    else ""
}
