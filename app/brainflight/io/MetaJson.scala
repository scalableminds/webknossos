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
case class MetaData(dataLayerSettings: DataLayerSettings, missions: List[Mission])

object MetaJsonHandler extends BoxImplicits{

  def parseSettings(js: JsObject) = {
    Logger.trace("MissionJsonParser->parseSettings: about to parse")
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
      DataLayerSettings(dataSetName, dataLayers)
    }
  }
  
  def parseMissions(js: JsObject, associatedDataSet: String) = {
    for {
      missions <- (js \ "tasks").asOpt[List[Mission]]
    } yield {missions.map(_.copy(dataSetName = associatedDataSet))}
  }

  def parse(js: JsValue): Option[MetaData] = {
    for {
      jsObj <- js.asOpt[JsObject]
      settings <- parseSettings(jsObj)
      missions <- parseMissions(jsObj, settings.dataSetName)
    } yield MetaData(settings, missions)
  }
  
  def JsonFromFile(file: File) = Json.parse(Source.fromFile(file).getLines.mkString)

  def extractMetaData(dataSetName: String): Box[MetaData] = {
    (for {
      dataSet <- DataSet.findOneByName(dataSetName) ?~ Messages(s"$dataSetName: dataSet.notFound")
      missionData = new File(dataSet.baseDir + "/meta.json") 
      if missionData.exists()
      metaData <- parse(JsonFromFile(missionData)) ?~ Messages(s"$dataSetName: Meta.json parsing Error")
    } yield {    
      metaData
    }) ?~ Messages(s"$dataSetName: meta.json not found") 
  }
  

}