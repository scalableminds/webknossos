package brainflight.io

import scala.collection.mutable.HashMap
import scala.collection.JavaConverters._
import name.pachler.nio.file._
import name.pachler.nio.file.impl.PathImpl
import akka.actor._
import akka.util.duration._
import play.api.libs.json._
import play.api.libs.iteratee._
import play.api.libs.concurrent._
import akka.util.Timeout
import akka.pattern.ask
import akka.dispatch.Terminate
import play.api.Play
import play.api.Logger

case class StartWatching(val pathName: String)
case class StopWatching()

class DirectoryWatcherActor(changeHandler: DirectoryChangeHandler) extends Actor {
  
  val TICKER_INTERVAL = 10 minutes
  
  Logger.warn("If an UnsatisfiedLinkError occours: Don't mind.")
  // TODO: fix classloader problems
  val watchService = FileSystems.getDefault().newWatchService()
  
  val keys = new HashMap[WatchKey, Path]
  var shouldStop = false
  var updateTicker: Cancellable = null

  def receive = {
    case StopWatching =>
      shouldStop = true
    case StartWatching(pathName) =>
      shouldStop = false
      val watchedPath = Paths.get(pathName)
      start(watchedPath)
  }

  /**
   * Print an event
   */
  def handleFileEvent(event: WatchEvent[_], parent: Path): Unit = {
    val kind = event.kind
    val event_path = event.context().asInstanceOf[Path]
    val path = parent.resolve(event_path)
    if (kind.equals(StandardWatchEventKind.ENTRY_CREATE)) {
      changeHandler.onCreate(path)
    } else if (kind.equals(StandardWatchEventKind.ENTRY_DELETE)) {
      changeHandler.onDelete(path)
    }
  }

  /**
   * Register a particular file or directory to be watched
   */
  def register(dir: Path): Unit = {
    val key = dir.register(watchService, StandardWatchEventKind.ENTRY_CREATE,
      StandardWatchEventKind.ENTRY_DELETE)
    keys(key) = dir
  }

  /**
   *  Recursively register directories
   */
  def registerAll(start: Path): Unit = {
    val file = start.asInstanceOf[PathImpl].getFile
    if (file.isDirectory()) {
      register(start)
      file.listFiles().map { child =>
        val path = new PathImpl(child)
        //registerAll(path)
      }
    }

  }

  /**
   * The main directory watching thread
   */
  def start(watchedPath: Path): Unit = {

    registerAll(watchedPath)
    changeHandler.onStart(watchedPath)
    sender ! true
    updateTicker = context.system.scheduler.schedule(TICKER_INTERVAL, TICKER_INTERVAL){ () =>
      changeHandler.onTick(watchedPath)
    }
    Akka.future {
      try {
        while (!shouldStop) {
          val key = watchService.take()
          keys.get(key).map { dir =>
            key.pollEvents().asScala.foreach(event => {
              val kind = event.kind

              if (kind != StandardWatchEventKind.OVERFLOW) {
                val name = event.context().asInstanceOf[Path]
                var child = dir.resolve(name)

                handleFileEvent(event, dir)

                if (kind == StandardWatchEventKind.ENTRY_CREATE) {
                  try {
                    val file = child.asInstanceOf[PathImpl].getFile
                    if (file.isDirectory()) {
                      registerAll(child);
                    }
                  } catch {
                    case e: Exception =>
                      println("Exception: " + e)
                      return
                  }
                }
              }
            })
          }

          if (!key.reset()) {
            keys.remove(key);
            if (keys.isEmpty) {
              return
            }
          }
        }
      } catch {
        case ie: InterruptedException => println("InterruptedException: " + ie)
        case e: Exception             => println("Exception: " + e)
      }
    }(Play.current)
  }

  override def postStop() = {
    shouldStop = true
    if (updateTicker != null)
      updateTicker.cancel()
  }
}