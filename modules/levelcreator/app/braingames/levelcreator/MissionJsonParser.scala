package braingames.levelcreator

import play.api.libs.json.JsValue
import play.api.libs.json.JsObject
import models.knowledge.Mission
import models.binary._
import play.api.Logger

case class DataLayerSettings(dataSetName: String)

class MissionJsonParser {

  def parseSettings(js: JsObject) = {
    Logger.info("MissionJsonParser->parseSettings: about to parse")
    for {
      settingsObj <- (js \ "settings").asOpt[JsObject]
      dataSetName <- (settingsObj \ "dataset").asOpt[String]
      dataLayersObj <- (settingsObj \ "dataLayers").asOpt[JsObject]
      colorLayer <- (dataLayersObj \ "color").asOpt[ColorLayer]
    } yield {
      val segmentationLayer = (dataLayersObj \ SegmentationLayer.identifier).asOpt[SegmentationLayer] match {
        case Some(layer) => Map(SegmentationLayer.identifier -> layer)
        case _ => Map()
      }
      val classificationLayer = (dataLayersObj \ ClassificationLayer.identifier).asOpt[ClassificationLayer] match {
        case Some(layer) => Map(ClassificationLayer.identifier -> layer)
        case _ => Map()
      }
      
      val dataLayers = Map(ColorLayer.identifier -> colorLayer) ++ segmentationLayer ++ classificationLayer
      Logger.info(dataLayers.mkString)
      DataLayerSettings(dataSetName)
    }
  }

  def parse(js: JsValue) = {
    (for {
      jsObj <- js.asOpt[JsObject]
      settings <- parseSettings(jsObj)
      missions <- (jsObj \ "tasks").asOpt[List[Mission]]
    } yield missions.map(_.copy(dataSetName = settings.dataSetName))) getOrElse Nil
  }
}