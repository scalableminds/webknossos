package brainflight.knowledge

import play.api.libs.json.JsValue
import play.api.libs.json.JsObject
import models.knowledge.Mission

case class DataLayerSettings(dataSetName: String)

class MissionJsonParser {

  def parseSettings(js: JsObject) =
    for {
      settingsObj <- (js \ "settings").asOpt[JsObject]
      dataSetName <- (settingsObj \ "dataset").asOpt[String]
    } yield DataLayerSettings(dataSetName)

  def parse(js: JsValue) = {
    (for {
      jsObj <- js.asOpt[JsObject]
      settings <- parseSettings(jsObj)
      missions <- (jsObj \ "tasks").asOpt[List[Mission]]
    } yield missions.map(_.copy(dataSetName = settings.dataSetName))) getOrElse Nil
  }
}