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
import java.io.File



object Global extends GlobalSettings {

  lazy val DirectoryWatcher = Akka.system.actorOf(
    Props(new DirectoryWatcherActor(new MongoDataSetChangeHandler)),
    name = "directoryWatcher")
    
  override def onStart(app: Application) {
      val conf = Play.current.configuration
      implicit val sys = Akka.system(app)
      implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 20) seconds)
      (DirectoryWatcher ? StartWatching(conf.getString("bindata.folder") getOrElse "binaryData")).onSuccess {
        case x =>
          if (Play.current.mode == Mode.Dev) {
            //BasicEvolution.runDBEvolution()
            // Data insertion needs to be delayed, because the dataSets need to be
            // found by the DirectoryWatcher first
            Logger.info("starting in Dev mode")
          }
          
      }
      StackWorkDistributor.start
      MissionWatcher.start
  }

  override def onStop(app: Application) {
    ActorSystems.dataRequestSystem.shutdown
    DirectoryWatcher ! StopWatching
    Akka.system.actorFor("/user/missionWatcher") ! StopWatchingForMissions()
    models.context.BinaryDB.connection.close()
    models.context.db.close()
  }
}