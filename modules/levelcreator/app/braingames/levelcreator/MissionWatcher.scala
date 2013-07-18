package braingames.levelcreator

import akka.actor._
import java.io.File
import scala.concurrent.duration._
import play.api.Logger
import play.api.libs.json._
import play.api.libs.json.Json._
import play.api.libs.functional.syntax._
import play.api.libs.concurrent.Execution.Implicits._
import braingames.binary.models.{DataLayer, DataSet}
import braingames.util.FileRegExFilter
import models.knowledge._
import models.binary._
import braingames.util.JsonHelper._
import braingames.util.ExtendedTypes._
import braingames.util.StartableActor
import models.knowledge.DataSetDAO
import models.basics.GlobalDBAccess

case class StartWatchingForMissions()

case class StopWatchingForMissions()

class MissionWatcher extends Actor with GlobalDBAccess {
  val TICKER_INTERVAL = 5 minutes

  var updateTicker: Option[Cancellable] = None

  override def preStart = {
    Logger.debug("About to start MissionWatcher")
    self ! StartWatchingForMissions()
  }

  def receive = {
    case StartWatchingForMissions() => start
    case StopWatchingForMissions() => stop
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

  val layerDirFilter = new FileRegExFilter( """^layer[0-9]+$""".r)

  def getMissionFiles(dataSet: DataSet): List[File] = {
    dataSet.dataLayer("segmentation").map {
      segmentationLayer =>
        segmentationLayer.sections.map {
          section =>
            new File(s"${dataSet.baseDir}/${section.baseDir}/missions.json")
        }.filter(_.isFile)

    } getOrElse Nil
  }

  def extractLayerId(missionFile: File) = {
    missionFile.getParentFile.getName.replaceFirst("layer", "").toIntOpt getOrElse 0
  }

  def insertMissionsIntoDB(missions: List[Mission]) = {
    missions.map(Mission.updateOrCreate)
  }

  def lookForMissions() = {
    DataSetDAO.findAll.map {
      _.foreach {
        dataSet =>
          val missions = readMissionsFromFile(getMissionFiles(dataSet), dataSet.name)
          val insertedMissions = insertMissionsIntoDB(missions)
          val removedMissions = Mission.deleteAllForDataSetExcept(dataSet.name, missions)

          Level.findActiveAutoRenderByDataSetName(dataSet.name).foreach {
            level =>
              Level.ensureMissions(level, insertedMissions)
          }

          removedMissions.map(RenderedStack.removeAllOfMission)

          Logger.info(s"Found ${missions.size} missions for dataset ${dataSet.name}")
      }
    }
  }

  def readMissionsFromFile(missionFiles: List[File], dataSetName: String): List[Mission] = {
    Logger.debug(s"processing $missionFiles for $dataSetName")
    (missionFiles.flatMap {
      missionFile =>
        JsonFromFile(missionFile)
          .asOpt[List[ContextFreeMission]]
          .map(_.map(_.addContext(dataSetName, extractLayerId(missionFile))))
    }).flatten
  }
}


object MissionWatcher extends StartableActor[MissionWatcher] {
  val name = "missionWatcher"
}