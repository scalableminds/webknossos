package models.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.tools.AutoFormat
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.MagRestrictions

object TracingMode extends ExtendedEnumeration {
  type TracingMode = Value
  val orthogonal, flight = Value
}

case class AnnotationSettings(
    allowedModes: List[TracingMode.Value],
    preferredMode: Option[TracingMode.Value] = None,
    branchPointsAllowed: Boolean = true,
    somaClickingAllowed: Boolean = true,
    volumeInterpolationAllowed: Boolean = true,
    mergerMode: Boolean = false,
    magRestrictions: MagRestrictions = MagRestrictions.empty
) derives AutoFormat

object AnnotationSettings {
  def defaultFor(tracingType: TracingType): AnnotationSettings = tracingType match {
    case TracingType.volume =>
      AnnotationSettings(allowedModes = List(TracingMode.orthogonal))
    case TracingType.skeleton | TracingType.hybrid =>
      AnnotationSettings(allowedModes = List(TracingMode.orthogonal, TracingMode.flight))
  }
}
