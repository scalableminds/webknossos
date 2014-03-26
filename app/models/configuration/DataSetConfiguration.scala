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
      "interpolation" -> JsBoolean(false),
      "fourBit" -> JsBoolean(false),
      "brightness" -> JsNumber(0),
      "contrast" -> JsNumber(1),
      "quality" -> JsNumber(0),
      "layerColors" -> JsObject(Seq.empty)))

}
