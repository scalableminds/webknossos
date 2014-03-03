package braingames.binary.watcher

import scala.collection.mutable.HashMap
import scala.collection.JavaConverters._
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
import scala.util.control.Breaks._
import java.nio.file.attribute._
import java.io.IOException
import akka.agent.Agent
import java.util.EnumSet
import java.nio.file.{Path => JavaPath, _}
import scalax.file.Path
import scala.Some

case class StartWatching(path: Path, recursive: Boolean)
case class StopWatching()

class DirectoryWatcherActor(config: Config, changeHandler: DirectoryChangeHandler) extends Actor {

  import braingames.binary.Logger._

  val TICKER_INTERVAL = config.getInt("tickerInterval") minutes

  implicit val ec = context.dispatcher

  implicit val system = context.system

  val _watchService = Agent[Map[JavaPath, WatchService]](Map.empty)
  val keys = new HashMap[WatchKey, JavaPath]

  var shouldStop = false
  var updateTicker: Option[Cancellable] = None

  def watchService(path: JavaPath) =
    _watchService().get(path).getOrElse {
      val ws = path.getFileSystem().newWatchService()
      _watchService.send(_ + (path -> ws))
      ws
    }

  def receive = {
    case StopWatching =>
      shouldStop = true
    case StartWatching(path, recursive) =>
      shouldStop = false
      if (path.exists) {
        start(Paths.get(path.path), recursive)
        sender ! true
      } else {
        logger.error(s"Can't watch $path because it doesn't exist.")
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
  def start(watchedJavaPath: JavaPath, recursive: Boolean): Unit = {
    changeHandler.onStart(watchedJavaPath, recursive)
    updateTicker = Some(context.system.scheduler.schedule(TICKER_INTERVAL, TICKER_INTERVAL) {
      changeHandler.onTick(watchedJavaPath, recursive)
    })
    // watchFile(watchedJavaPath, recursive)
  }

  /**
   * Print an event
   */
  def handleEvent(event: WatchEvent[_]): Unit = {
    val kind = event.kind
    val event_path = event.context().asInstanceOf[JavaPath]
    if (kind.equals(StandardWatchEventKinds.ENTRY_CREATE)) {
      changeHandler.onCreate(event_path)
    } else if (kind.equals(StandardWatchEventKinds.ENTRY_DELETE)) {
      changeHandler.onDelete(event_path)
    } else if (kind.equals(StandardWatchEventKinds.ENTRY_MODIFY)) {
      //
    }
  }

  /**
   * Register a particular file or directory to be watched
   */
  def register(dir: JavaPath, root: Option[JavaPath] = None): Unit = {
    val ws = watchService(root getOrElse dir)
    val key = dir.register(ws, StandardWatchEventKinds.ENTRY_CREATE,
      StandardWatchEventKinds.ENTRY_MODIFY,
      StandardWatchEventKinds.ENTRY_DELETE)

    keys(key) = dir
  }

  /**
   * Makes it easier to walk a file tree
   */
  implicit def makeDirVisitor(f: (JavaPath) => Unit) = new SimpleFileVisitor[JavaPath] {
    override def preVisitDirectory(p: JavaPath, attrs: BasicFileAttributes) = {
      f(p)
      FileVisitResult.CONTINUE
    }
  }

  /**
   *  Recursively register directories
   */
  def registerAll(start: JavaPath, root: Option[JavaPath] = None): Unit = {
    try {
      Files.walkFileTree(start, Set(FileVisitOption.FOLLOW_LINKS).asJava, Integer.MAX_VALUE,
        (f: JavaPath) => {
          register(f, root orElse Some(start))
        })
    } catch {
      case e: FileSystemLoopException =>
        logger.error("Found a file system loop. :(", e)
    }
  }

  def watchFile(path: JavaPath, recursive: Boolean) {
    try {
      if (recursive) {
        registerAll(path)
      } else {
        register(path)
      }

      Future {
        breakable {
          while (true) {
            val key = watchService(path).take()
            val dir = keys.getOrElse(key, null)
            if (dir != null) {
              key.pollEvents().asScala.foreach(event => {
                val kind = event.kind

                if (kind != StandardWatchEventKinds.OVERFLOW) {
                  val name = event.context().asInstanceOf[JavaPath]
                  var child = dir.resolve(name)

                  handleEvent(event)

                  if (recursive && (kind == StandardWatchEventKinds.ENTRY_CREATE)) {
                    try {
                      if (Files.isDirectory(child, LinkOption.NOFOLLOW_LINKS)) {
                        registerAll(child, Some(path));
                      }
                    } catch {
                      case ioe: IOException =>
                        logger.error("IOException while watching for file changes.", ioe)
                      case e: Exception =>
                        logger.error("Exception while watching for file changes.",e)
                        break
                    }
                  }
                }
              })
            } else {
              logger.warn("WatchKey not recognized!")
            }

            if (!key.reset()) {
              keys.remove(key);
              if (keys.isEmpty) {
                break
              }
            }
          }
        }
      }
    } catch {
      case e: Exception =>
        logger.error("File watcher stopped due to Exception. ", e)
    }
  }

  override def postStop() = {
    super.postStop()
    shouldStop = true
    updateTicker.map(_.cancel())
  }
}