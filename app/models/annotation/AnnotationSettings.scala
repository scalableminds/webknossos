package models.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.MagRestrictions
import play.api.libs.json._

object TracingMode extends ExtendedEnumeration {
  type TracingMode = Value
  val orthogonal, oblique, flight = Value
}

case class AnnotationSettings(
    allowedModes: List[TracingMode.Value],
    preferredMode: Option[TracingMode.Value] = None,
    branchPointsAllowed: Boolean = true,
    somaClickingAllowed: Boolean = true,
    volumeInterpolationAllowed: Boolean = true,
    mergerMode: Boolean = false,
    magRestrictions: MagRestrictions = MagRestrictions.empty
)

object AnnotationSettings {
  def defaultFor(tracingType: TracingType): AnnotationSettings = tracingType match {
    case TracingType.volume =>
      AnnotationSettings(allowedModes = List(TracingMode.orthogonal))
    case TracingType.skeleton | TracingType.hybrid =>
      AnnotationSettings(allowedModes = List(TracingMode.orthogonal, TracingMode.oblique, TracingMode.flight))
  }

  implicit val jsonFormat: OFormat[AnnotationSettings] = Json.format[AnnotationSettings]
}
