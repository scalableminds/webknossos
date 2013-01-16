package brainflight.io

import play.api.libs.json.JsValue
import play.api.libs.json.JsObject
import models.knowledge.Mission
import models.binary._
import play.api.Logger
import scala.io.Source
import java.io.File
import play.api.libs.json._
import play.api.i18n.Messages
import braingames.mvc.BoxImplicits
import net.liftweb.common.Box


case class DataLayerSettings(dataSetName: String, dataLayers: Map[String, DataLayer])
case class MetaJson(dataLayerSettings: DataLayerSettings, missions: List[Mission])

object MetaJsonHandler extends BoxImplicits{

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
      DataLayerSettings(dataSetName, dataLayers)
    }
  }
  
  def parseMissions(js: JsObject, associatedDataSet: String) = {
    for {
      missions <- (js \ "tasks").asOpt[List[Mission]]
    } yield {missions.map(_.copy(dataSetName = associatedDataSet))}
  }

  def parse(js: JsValue): Option[MetaJson] = {
    for {
      jsObj <- js.asOpt[JsObject]
      settings <- parseSettings(jsObj)
      missions <- parseMissions(jsObj, settings.dataSetName)
    } yield MetaJson(settings, missions)
  }
  
  def JsonFromFile(file: File) = Json.parse(Source.fromFile(file).getLines.mkString)

  def insertMetaData(dataSetName: String): Box[String] = {
    (for {
      dataSet <- DataSet.findOneByName(dataSetName) ?~ Messages("dataSet.notFound")
      missionData = new File(dataSet.baseDir + "/meta.json") 
      if missionData.exists()
      MetaJson <- parse(JsonFromFile(missionData)) ?~ Messages("Meta.json parsing Error")
    } yield {    
      
      val newMissions = MetaJson.missions.filterNot(Mission.hasAlreadyBeenInserted)
      insertMissions(newMissions)     
      insertDataLayers(dataSet, MetaJson.dataLayerSettings.dataLayers)
      
      "Inserted %s new missions and updated DataLayers %s.".format(newMissions.size, MetaJson.dataLayerSettings.dataLayers.keys)
    }) ?~ Messages("mission.metaFile.notFound") 
  }
  
  def insertMissions(missions: List[Mission]) = {
    missions.foreach(Mission.insertOne)
  }
  
  def insertDataLayers(dataSet: DataSet, newDataLayers: Map[String, DataLayer]) = {
    DataSet.updateOrCreate(dataSet.copy(dataLayers = newDataLayers))
  }
}