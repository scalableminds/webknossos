package models.annotation

import play.api.libs.json._
import play.api.libs.json.Json._
import models.basics.BasicSettings

import AnnotationSettings._

case class AnnotationSettings(allowedModes: List[String] = SKELETON_MODES,
                              branchPointsAllowed: Boolean = true,
                              somaClickingAllowed: Boolean = true
                             )

object AnnotationSettings {
  val OXALIS = "oxalis"
  val ARBITRARY = "arbitrary"
  val VOLUME = "volume"


  val ALL_MODES = List(OXALIS, ARBITRARY, VOLUME)
  val SKELETON_MODES = List(OXALIS, ARBITRARY)
  val VOLUME_MODES = List(VOLUME)

  val default = AnnotationSettings()
  val skeletonDefault = AnnotationSettings(allowedModes = SKELETON_MODES)
  val volumeDefault = AnnotationSettings(allowedModes = VOLUME_MODES)

  implicit val annotationSettingsFormat = Json.format[AnnotationSettings]
}
