package models.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.ResolutionRestrictions
import models.annotation.AnnotationSettings.skeletonModes
import play.api.libs.json._

object TracingMode extends ExtendedEnumeration {
  type TracingMode = Value
  val orthogonal, oblique, flight, volume = Value
}

case class AnnotationSettings(
    allowedModes: List[TracingMode.Value] = skeletonModes,
    preferredMode: Option[String] = None,
    branchPointsAllowed: Boolean = true,
    somaClickingAllowed: Boolean = true,
    mergerMode: Boolean = false,
    resolutionRestrictions: ResolutionRestrictions = ResolutionRestrictions.empty
)

object AnnotationSettings {
  val ORTHOGONAL = "orthogonal"
  val OBLIQUE = "oblique"
  val FLIGHT = "flight"
  val VOLUME = "volume"

  private val skeletonModes = List(TracingMode.orthogonal, TracingMode.oblique, TracingMode.flight)
  private val volumeModes = List(TracingMode.volume)
  private val allModes = skeletonModes ::: volumeModes

  def defaultFor(tracingType: TracingType): AnnotationSettings = tracingType match {
    case TracingType.skeleton =>
      AnnotationSettings(allowedModes = skeletonModes)
    case TracingType.volume =>
      AnnotationSettings(allowedModes = volumeModes)
    case TracingType.hybrid =>
      AnnotationSettings(allowedModes = allModes)
  }

  implicit val jsonFormat: OFormat[AnnotationSettings] = Json.format[AnnotationSettings]
}
