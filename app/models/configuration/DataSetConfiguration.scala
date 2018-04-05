package models.configuration

import models.basics.BasicSettings
import play.api.libs.json._

case class DataSetConfiguration(configuration: Map[String, JsValue]) {

  def configurationOrDefaults = {
    DataSetConfiguration.default.configuration ++ configuration
  }

}

object DataSetConfiguration extends BasicSettings {

  implicit val dataSetConfigurationFormat = Json.format[DataSetConfiguration]

  val default = DataSetConfiguration(
    Map(
      "fourBit" -> JsBoolean(false),
      "quality" -> JsNumber(0),
      "interpolation" -> JsBoolean(true),
      "segmentationOpacity" -> JsNumber(20)))
}
