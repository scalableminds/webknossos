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



object Global extends GlobalSettings {

  lazy val DirectoryWatcher = Akka.system.actorOf(
    Props(new DirectoryWatcherActor(new DataSetChangeHandler)),
    name = "directoryWatcher")

  override def onStart(app: Application) {
      implicit val timeout = Timeout(5 seconds)
      (DirectoryWatcher ? StartWatching("binaryData")).onSuccess {
        case x =>
          if (Play.current.mode == Mode.Dev) {
            BasicEvolution.runDBEvolution()
            // Data insertion needs to be delayed, because the dataSets need to be
            // found by the DirectoryWatcher first
            InitialData.insert()
          }
      }
  }

  override def onStop(app: Application) {
    ActorSystems.dataRequestSystem.shutdown
    DirectoryWatcher ! StopWatching
    models.context.BinaryDB.connection.close()
    models.context.db.close()
  }
}