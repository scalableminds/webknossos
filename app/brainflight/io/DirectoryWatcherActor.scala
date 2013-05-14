package brainflight.io

import scala.collection.mutable.HashMap
import scala.collection.JavaConverters._
import name.pachler.nio.file._
import name.pachler.nio.file.impl.PathImpl
import akka.actor._
import play.api.libs.json._
import play.api.libs.iteratee._
import play.api.libs.concurrent._
import akka.util.Timeout
import akka.pattern.ask
import play.api.Play
import akka.util
import play.api.Logger
import play.utils.Threads
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.duration._
import scala.concurrent.Future
import java.io.File

case class StartWatching(val pathName: String)
case class StopWatching()

class DirectoryWatcherActor(changeHandler: DirectoryChangeHandler) extends Actor {

  val TICKER_INTERVAL = 10 minutes

  Logger.warn("If an UnsatisfiedLinkError occours: Don't mind.")
  // TODO: fix classloader problems
  val watchServiceOpt = Threads.withContextClassLoader(Play.current.classloader) {
    Some(FileSystems.getDefault().newWatchService())
  }

  val keys = new HashMap[WatchKey, Path]
  var shouldStop = false
  var updateTicker: Option[Cancellable] = None

  def receive = {
    case StopWatching =>
      shouldStop = true
    case StartWatching(pathName) =>
      val t = System.currentTimeMillis()
      shouldStop = false
      if(new File(pathName).exists){
        val watchedPath = Paths.get(pathName)
          start(watchedPath)
          sender ! true
      } else {
        Logger.error(s"Can't watch $pathName because it doesn't exist.")
        sender ! false
      }
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
  def register(dir: Path, watchService: WatchService): Unit = {
    val key = dir.register(watchService, StandardWatchEventKind.ENTRY_CREATE,
      StandardWatchEventKind.ENTRY_DELETE)
    keys(key) = dir
  }

  /**
   *  Recursively register directories
   */
  def registerAll(start: Path, watchService: WatchService): Unit = {
    val file = start.asInstanceOf[PathImpl].getFile
    if (file.isDirectory()) {
      register(start, watchService)
      file.listFiles().map { child =>
        val path = new PathImpl(child)
        registerAll(path, watchService)
      }
    }
  }

  /**
   * The main directory watching thread
   */
  def start(watchedPath: Path): Unit = {
    changeHandler.onStart(watchedPath)
    updateTicker = Some(context.system.scheduler.schedule(TICKER_INTERVAL, TICKER_INTERVAL) {
      changeHandler.onTick(watchedPath)
    })

    watchServiceOpt.map { watchService =>
      register(watchedPath, watchService)
      Future {
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
                    val file = child.asInstanceOf[PathImpl].getFile
                    if (file.isDirectory()) {
                      register(child, watchService)
                    }
                  }
                }
              })
            }

            if (!key.reset()) {
              keys.remove(key);
              if (keys.isEmpty) {
                shouldStop = true
              }
            }
          }
        } catch {
          case ie: InterruptedException                             => Logger.error(s"InterruptedException: $ie")
          case e: name.pachler.nio.file.ClosedWatchServiceException =>
          // everything is fine, the actor is going to get shut down
          case e: Exception                                         => Logger.error(s"Exception: $e")
        }
      }(context.dispatcher)
    }
  }

  override def postStop() = {
    super.postStop()
    shouldStop = true
    updateTicker.map(_.cancel())
    watchServiceOpt.map(_.close())
  }
}