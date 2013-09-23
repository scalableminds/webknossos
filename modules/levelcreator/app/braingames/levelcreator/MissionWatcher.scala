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
import braingames.util.JsonHelper._
import braingames.util.ExtendedTypes._
import braingames.util.StartableActor
import models.knowledge.DataSetDAO
import braingames.reactivemongo.GlobalDBAccess
import scala.concurrent.Future

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

  /**
   * TODO: this should be put into the missions file #error-prone
   * @param missionFile
   * @return
   */
  def extractSectionId(missionFile: File) = {
    missionFile.getParentFile.getName.replaceFirst("layer", "").toIntOpt getOrElse 0
  }

  def insertMissionsIntoDB(missions: Iterable[Mission]) = {
    missions.map(MissionDAO.updateOrCreate)
  }

  def lookForMissions() = {
    DataSetDAO.findAll.map {
      _.foreach {
        dataSet =>
          processMissionFiles(getMissionFiles(dataSet), dataSet.name)
      }
    }
  }

  def processMissionFiles(missionFiles: List[File], dataSetName: String): Unit = {
    Logger.debug(s"processing $missionFiles for $dataSetName")
    missionFiles.foreach {
      missionFile =>
        val sectionId = extractSectionId(missionFile)
        val missions = JsonFromFile(missionFile)
          .asOpt[List[ContextFreeMission]]
          .map(_.map(_.addContext(dataSetName, sectionId))) getOrElse Nil
        Future.sequence(insertMissionsIntoDB(missions)).map{ _ =>
          Logger.info(s"Found ${missions.size} missions for dataset ${dataSetName}")
        }
    }
  }
}


object MissionWatcher extends StartableActor[MissionWatcher] {
  val name = "missionWatcher"
}