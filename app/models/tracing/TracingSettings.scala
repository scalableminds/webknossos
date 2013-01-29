package models.tracing

import play.api.libs.json._
import play.api.libs.json.Json._
import models.basics.BasicSettings

import TracingSettings._

case class TracingSettings(
    allowedModes: List[String] = List(OXALIS, ARBITRARY, NOBRANCH))

object TracingSettings{
  val OXALIS = "oxalis"
  val ARBITRARY = "arbitrary"
  val NOBRANCH = "nobranch"
    
  val default = TracingSettings()  
    
  implicit val TracingWrites: Writes[TracingSettings] = new Writes[TracingSettings]{
    def writes(t: TracingSettings) = {
      Json.obj("allowedModes" -> t.allowedModes)
    }
  }
}