package models.configuration

import models.binary.DataSet
import play.api.libs.json._

case class DataSetConfiguration(configuration: Map[String, JsValue]) {

  def configurationOrDefaults = {
    DataSetConfiguration.constructInitialDefault(List()).configuration ++ configuration
  }

}

object DataSetConfiguration {

  implicit val dataSetConfigurationFormat = Json.format[DataSetConfiguration]

  def constructInitialDefault(dataSet: DataSet): DataSetConfiguration =
    constructInitialDefault(dataSet.dataSource.toUsable.map(d => d.dataLayers.map(_.name)).getOrElse(List()))

  def constructInitialDefault(layerNames: List[String]): DataSetConfiguration = {
    val layerValues = Json.toJson(layerNames.map(layerName => Json.obj(layerName -> initialDefaultPerLayer)))

    DataSetConfiguration(
      Map(
        "fourBit" -> JsBoolean(false),
        "quality" -> JsNumber(0),
        "interpolation" -> JsBoolean(true),
        "segmentationOpacity" -> JsNumber(20),
        "layers" -> layerValues)
    )
  }

  val initialDefaultPerLayer = Json.obj(
    "brightness" -> 0,
    "contrast" -> 1,
    "color" -> Json.arr(255, 255, 255)
  )

}
