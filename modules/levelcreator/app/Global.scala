import play.api._
import play.api.Play.current
import play.api.libs.concurrent._

import akka.pattern.ask
import akka.util.Timeout
import akka.actor.ActorSystem
import akka.actor.Props

import brainflight.io._
import scala.concurrent.duration._
import play.api.libs.concurrent.Execution.Implicits._
import models.basics.BasicEvolution
import brainflight.ActorSystems

import braingames.levelcreator._



object Global extends GlobalSettings {

  lazy val DirectoryWatcher = Akka.system.actorOf(
    Props(new DirectoryWatcherActor(new DataSetChangeHandler)),
    name = "directoryWatcher")
    
  lazy val MissionWatcher = Akka.system.actorOf(
    Props(new MissionWatcher),
    name = "missionWatcher")
    
  override def onStart(app: Application) {
      val conf = Play.current.configuration
      implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 20) seconds)
      (DirectoryWatcher ? StartWatching("knowledge")).onSuccess {
        case x =>
          if (Play.current.mode == Mode.Dev) {
            //BasicEvolution.runDBEvolution()
            // Data insertion needs to be delayed, because the dataSets need to be
            // found by the DirectoryWatcher first
            MissionWatcher ! StartWatchingForMissions
            Logger.info("starting in Dev mode")
          }
      }
  }

  override def onStop(app: Application) {
    ActorSystems.dataRequestSystem.shutdown
    DirectoryWatcher ! StopWatching
    MissionWatcher ! StopWatchingForMissions
    models.context.BinaryDB.connection.close()
    models.context.db.close()
  }
}