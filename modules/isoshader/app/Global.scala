import play.api._
import play.api.Play.current
import play.api.libs.concurrent._

import akka.pattern.ask
import akka.util.Timeout
import akka.actor.ActorSystem
import akka.actor.Props

import oxalis.io._
import scala.concurrent.duration._
import play.api.libs.concurrent.Execution.Implicits._
import oxalis.ActorSystems

object Global extends GlobalSettings {
  lazy val DirectoryWatcher = Akka.system.actorOf(
    Props(new DirectoryWatcherActor(new DataSetChangeHandler)),
    name = "directoryWatcher")
    
  override def onStart(app: Application) {
    val conf = Play.current.configuration
    implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 20) seconds)
    (DirectoryWatcher ? StartWatching("binaryData")).onSuccess {
      case _ =>
        if (Play.current.mode == Mode.Dev) {
          Logger.info("starting in Dev mode")
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