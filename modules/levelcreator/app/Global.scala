import play.api._
import play.api.Play.current
import play.api.libs.concurrent._
import akka.pattern.ask
import akka.util.Timeout
import akka.actor.ActorSystem
import akka.actor.Props
import scala.concurrent.duration._
import play.api.libs.concurrent.Execution.Implicits._
import braingames.levelcreator._
import java.io.File



object Global extends GlobalSettings {
    
  override def onStart(app: Application) {
      val conf = app.configuration
      implicit val sys = Akka.system(app)
      implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 20) seconds)
      BinaryDataService.start()
      StackWorkDistributor.start
      MissionWatcher.start
  }

  override def onStop(app: Application) {
    BinaryDataService.stop()
    Akka.system.actorFor("/user/missionWatcher") ! StopWatchingForMissions()
    models.context.BinaryDB.connection.close()
    models.context.db.close()
  }
}