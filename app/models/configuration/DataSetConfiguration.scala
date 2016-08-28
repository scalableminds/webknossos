package models.configuration

import play.api.libs.json._
import models.basics.BasicSettings

case class DataSetConfiguration(configuration: Map[String, JsValue]) {

  def configurationOrDefaults = {
    DataSetConfiguration.default.configuration ++ configuration
  }

}

object DataSetConfiguration extends BasicSettings {

  implicit val dataSetConfigurationFormat = Json.format[DataSetConfiguration]

  val default = DataSetConfiguration(
    Map(
      "fourBit" -> JsBoolean(true),
      "quality" -> JsNumber(0),
      "interpolation" -> JsBoolean(false),
      "layers" -> Json.obj()))

}
