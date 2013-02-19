package braingames.levelcreator

import akka.actor._
import java.io.File
import scala.concurrent.duration._
import play.api.Logger
import play.api.libs.json._
import play.api.libs.concurrent.Execution.Implicits._
import models.binary.DataSet
import braingames.util.FileRegExFilter
import models.knowledge._
import models.binary._
import braingames.util.JsonHelper._

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
  
  val missionRegEx = """missions[0-9]{3}\.json""".r
  val missionMetaFilter = new FileRegExFilter(missionRegEx)
  
  def checkMetaData() = {
    DataSet.findAll.toList.foreach { dataSet => 
      val baseFolder = new File(dataSet.baseDir)
      if (baseFolder.exists) {
        val missions = extractMissions(baseFolder.listFiles(missionMetaFilter).toList, dataSet.name)
        missions.foreach{Mission.updateOrCreate}
        Logger.debug(s"found ${missions.size} missions for dataset ${dataSet.name}")
      }
      else
        Logger.info(s"no settings.json found for ${dataSet.name}")
    }
  }
  
  def extractMissions(missionFiles: List[File], dataSetName: String) = {    
    (missionFiles.flatMap{ missionFile => 
      parseMissions(JsonFromFile(missionFile).as[JsObject])
    }).flatten.map(mission => mission.withDataSetName(dataSetName))
  }
  
  def parseMissions(js: JsObject) = {
    (js \ "missions").asOpt[List[Mission]]
  }
  
}