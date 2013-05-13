package braingames.io

import scala.collection.mutable.HashMap
import scala.collection.JavaConverters._
import name.pachler.nio.file._
import name.pachler.nio.file.impl.PathImpl
import akka.actor._
import play.api.libs.json._
import play.api.libs.iteratee._
import akka.util.Timeout
import akka.pattern.ask
import akka.util
import scala.concurrent.duration._
import scala.concurrent.Future
import java.io.File
import com.typesafe.config.Config

case class StartWatching(val pathName: String)
case class StopWatching()

class DirectoryWatcherActor(config: Config, changeHandler: DirectoryChangeHandler) extends Actor {

  val TICKER_INTERVAL = config.getInt("tickerInterval") minutes

  implicit val ec = context.dispatcher
  
  var shouldStop = false
  var updateTicker: Option[Cancellable] = None

  def receive = {
    case StopWatching =>
      shouldStop = true
    case StartWatching(pathName) =>
      shouldStop = false
      if(new File(pathName).exists){
        val watchedPath = Paths.get(pathName)
          start(watchedPath)
          sender ! true
      } else {
        System.err.println(s"Can't watch $pathName because it doesn't exist.")
        sender ! false
      }
  }

  /**
   * See https://gist.github.com/eberle1080/1241375
   * for using Java 7 file watcher
   */
  
  /**
   * The main directory watching thread
   */
  def start(watchedPath: Path): Unit = {
    changeHandler.onStart(watchedPath)
    updateTicker = Some(context.system.scheduler.schedule(TICKER_INTERVAL, TICKER_INTERVAL) { () =>
      changeHandler.onTick(watchedPath)
    })
  }

  override def postStop() = {
    super.postStop()
    shouldStop = true
    updateTicker.map(_.cancel())
  }
}