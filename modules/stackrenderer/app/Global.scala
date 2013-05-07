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
import braingames.stackrenderer._
import brainflight.io.DirectoryWatcherActor
import models.stackrenderer.TemporaryDataSetWatcher

object Global extends GlobalSettings {
    
  
  override def onStart(app: Application) {
      val conf = Play.current.configuration
      
      implicit val sys = Akka.system(app)
      StackRenderingSupervisor.start ! StartRendering()
      
      val binaryDataFolder = conf.getString("bindata.folder") getOrElse ("binaryData")
      TemporaryDataSetWatcher.start(binaryDataFolder)
  }

  override def onStop(app: Application) {

  }
}