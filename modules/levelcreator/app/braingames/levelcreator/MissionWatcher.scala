package braingames.levelcreator

import akka.actor._
import java.io.File
import scala.concurrent.duration._
import play.api.Logger
import play.api.libs.json._
import play.api.libs.json.Json._
import play.api.libs.functional.syntax._
import play.api.libs.concurrent.Execution.Implicits._
import models.binary.DataSet
import braingames.util.FileRegExFilter
import models.knowledge._
import models.binary._
import braingames.util.JsonHelper._
import braingames.util.ExtendedTypes._
import braingames.util.StartableActor

case class StartWatchingForMissions()
case class StopWatchingForMissions()

class MissionWatcher extends Actor {
  val TICKER_INTERVAL = 5 minutes

  var updateTicker: Option[Cancellable] = None

  override def preStart = {
    
    self ! StartWatchingForMissions()
  }
  
  def receive = {
    case StartWatchingForMissions() => start
    case StopWatchingForMissions()  => stop
  }

  def start = {
    Logger.info("Watching for Missions...")
    updateTicker = Some(context.system.scheduler.schedule(0 seconds, TICKER_INTERVAL) {
      lookForMissions()
    })
  }

  def stop = {
    updateTicker.map(_.cancel())
  }

  val layerDirFilter = new FileRegExFilter("""^layer[0-9]+$""".r)
  
  def getMissionFiles(dataSet: DataSet): List[File] = {
    for{segmentationLayer <- dataSet.segmentationLayers
        missionsFile = new File(s"${dataSet.baseDir}/${segmentationLayer.baseDir}/missions.json")
        if missionsFile.isFile
    } yield {
      missionsFile
    }
  }
  
  def extractLayerId(missionFile: File) = {
    missionFile.getParentFile.getName.replaceFirst("layer","").toIntOpt getOrElse 0
  }

  def lookForMissions() = {
    DataSet.findAll.toList.foreach { dataSet =>

      val missions = aggregateMissions(getMissionFiles(dataSet), dataSet.name)
      val availableMissionIds = missions.map { Mission.updateOrCreate(_) }
      val removedMissionIds = Mission.deleteAllForDataSetExcept(dataSet.name, missions)
      
      Level.findActiveAutoRenderByDataSetName(dataSet.name).foreach { level =>
        Level.ensureMissions(level, availableMissionIds)
      }
      
      removedMissionIds.map { missionId =>
        RenderedStack.removeAllOfMission(missionId)
      }

      Logger.debug(s"found ${missions.size} missions for dataset ${dataSet.name}")
    }
  }

  def aggregateMissions(missionFiles: List[File], dataSetName: String): List[Mission] = {
    Logger.info(s"processing $missionFiles for $dataSetName")
    (missionFiles.flatMap { missionFile =>
      JsonFromFile(missionFile)
        .asOpt[List[ContextFreeMission]]
        .map(_.map(_.addContext(dataSetName, extractLayerId(missionFile))))
    }).flatten
  }
}


object MissionWatcher extends StartableActor[MissionWatcher] {
  val name = "missionWatcher"
}