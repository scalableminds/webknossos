package com.scalableminds.braingames.binary.watcher

import scala.collection.mutable.HashMap
import akka.actor._
import scala.concurrent.duration._
import scala.concurrent.Future
import com.typesafe.config.Config
import akka.agent.Agent
import java.nio.file.{Path => JavaPath, _}
import scalax.file.Path
import scala.Some

case class StartWatching(path: Path, recursive: Boolean)

class DirectoryWatcherActor(config: Config, changeHandler: DirectoryChangeHandler) extends Actor {

  import com.scalableminds.braingames.binary.Logger._

  val TICKER_INTERVAL = config.getInt("tickerInterval") minutes

  implicit val ec = context.dispatcher

  implicit val system = context.system

  var updateTicker: Option[Cancellable] = None

  def receive = {
    case StartWatching(path, recursive) =>
      if (path.exists) {
        try {
          start(Paths.get(path.path), recursive)
          logger.info(s"Successfully watching ${path.path}.")
        } catch {
          case e: Exception =>
            logger.error(s"Failed to watch ${path.path}. Error: ${e.getMessage}", e)
        }
      } else {
        logger.error(s"Can't watch $path because it doesn't exist.")
        sender ! false
      }
  }

  /**
   * The main directory watching thread
   */
  def start(watchedJavaPath: JavaPath, recursive: Boolean): Unit = {
    Future{
      changeHandler.onStart(watchedJavaPath, recursive)
    }
    updateTicker = Some(context.system.scheduler.schedule(TICKER_INTERVAL, TICKER_INTERVAL) {
      changeHandler.onTick(watchedJavaPath, recursive)
    })
  }

  override def postStop() = {
    updateTicker.map(_.cancel())
    super.postStop()
  }
}