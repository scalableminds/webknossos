package braingames.levelcreator

import akka.actor._
import java.io.File
import scala.io.Source
import scala.concurrent.duration._
import play.api.Logger
import play.api.libs.json._
import play.api.libs.concurrent.Execution.Implicits._
import models.binary.DataSet
import braingames.util.FileRegExFilter
import models.knowledge._
import models.binary._

case class StartWatchingMetaData()
case class StopWatchingMetaData()

class MetaDataActor extends Actor{
  val TICKER_INTERVAL = 1 minute
  
  var updateTicker: Cancellable = null
  
  def receive = {
    case StartWatchingMetaData() => start
    case StopWatchingMetaData() => stop
  }
  
  def start = {
    Logger.debug("Starting metadata ticker")
    updateTicker = context.system.scheduler.schedule(0 seconds, TICKER_INTERVAL){
      checkMetaData()
    }
  }
  
  def stop = {
    updateTicker.cancel
  }
  
  val missionRegEx = """mission[0-9]{3}\.json""".r
  val missionMetaFilter = new FileRegExFilter(missionRegEx)
  
  def checkMetaData() = {
    DataSet.findAll.toList.foreach { dataSet => 
      val baseFolder = new File(dataSet.baseDir)
      val settingsJson = new File(dataSet.baseDir + "/settings.json")
      if (settingsJson.exists) {
        for {settings <- extractSettings(settingsJson)
             missions = extractMissions(baseFolder.listFiles(missionMetaFilter).toList, dataSet.name)
        }{
        dataSet.updateDataLayers(settings)
        Logger.debug(s"added ${settings} to dataSet ${dataSet.name}")
        missions.foreach{Mission.updateOrCreate}
        Logger.debug(s"found ${missions.size} missions for dataset ${dataSet.name}")
        }
      }
      else
        Logger.info(s"no settings.json found for ${dataSet.name}")
    }
  }
  
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
      
      Map(ColorLayer.identifier -> colorLayer) ++ segmentationLayer ++ classificationLayer
    }
  }
  
  def extractSettings(settingsFile: File) = {
    parseSettings(JsonFromFile(settingsFile).as[JsObject])
  }
  
  def extractMissions(missionFiles: List[File], dataSetName: String) = {    
    (missionFiles.flatMap{ missionFile => 
      parseMissions(JsonFromFile(missionFile).as[JsObject])
    }).flatten.map(mission => mission.withDataSetName(dataSetName))
  }
  
  def parseMissions(js: JsObject) = {
    (js \ "missions").asOpt[List[Mission]]
  }
  
  def JsonFromFile(file: File) = Json.parse(Source.fromFile(file).getLines.mkString)

}