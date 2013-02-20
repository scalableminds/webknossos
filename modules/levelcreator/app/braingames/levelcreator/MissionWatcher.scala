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

case class StartWatchingForMissions()
case class StopWatchingForMissions()

class MissionWatcher extends Actor{
  val TICKER_INTERVAL = 5 minutes
  
  var updateTicker: Cancellable = null
  
  def receive = {
    case StartWatchingForMissions() => start
    case StopWatchingForMissions() => stop
  }
  
  def start = {
    Logger.debug("Watching for Missions...")
    updateTicker = context.system.scheduler.schedule(0 seconds, TICKER_INTERVAL){
      lookForMissions()
    }
  }
  
  def stop = {
    updateTicker.cancel
  }
  
  val missionFileNameRegEx = """missions[0-9]{4}\.json""".r
  val missionFileFilter = new FileRegExFilter(missionFileNameRegEx)
  
  def lookForMissions() = {
    DataSet.findAll.toList.foreach { dataSet => 
      val baseFolder = new File(dataSet.baseDir)
      if (baseFolder.exists) {
        val missions = aggregateMissions(baseFolder.listFiles(missionFileFilter).toList, dataSet.name)
        missions.foreach{Mission.updateOrCreate}
        Logger.debug(s"found ${missions.size} missions for dataset ${dataSet.name}")
      }
    }
  }
  
  def aggregateMissions(missionFiles: List[File], dataSetName: String) = {    
    (missionFiles.flatMap{ missionFile => 
      parseMissions(JsonFromFile(missionFile).as[JsObject])
    }).flatten.map(mission => mission.withDataSetName(dataSetName))
  }
  
  def parseMissions(js: JsObject) = {
    (js \ "missions").asOpt[List[Mission]]
  }
  
}