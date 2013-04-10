package models.tracing

import play.api.libs.json._
import play.api.libs.json.Json._
import models.basics.BasicSettings

import TracingSettings._

case class TracingSettings(
  allowedModes: List[String] = ALL_MODES, 
  branchPointsAllowed: Boolean = true,
  somaClickingAllowed: Boolean = true,
  isEditable: Boolean = true)

object TracingSettings {
  val OXALIS = "oxalis"
  val ARBITRARY = "arbitrary"

  val ALL_MODES = List(OXALIS, ARBITRARY)

  val default = TracingSettings()

  implicit val TracingWrites: Writes[TracingSettings] = Json.writes[TracingSettings]
}