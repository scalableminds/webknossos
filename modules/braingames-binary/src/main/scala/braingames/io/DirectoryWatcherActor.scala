package braingames.io

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
import java.nio.file._
import akka.agent.Agent

case class StartWatching(pathName: String, recursive: Boolean)
case class StopWatching()

class DirectoryWatcherActor(config: Config, changeHandler: DirectoryChangeHandler) extends Actor {

  val TICKER_INTERVAL = config.getInt("tickerInterval") minutes

  implicit val ec = context.dispatcher

  implicit val system = context.system

  val _watchService = Agent[Map[Path, WatchService]](Map.empty)
  val keys = new HashMap[WatchKey, Path]
  var trace = false

  var shouldStop = false
  var updateTicker: Option[Cancellable] = None

  def watchService(path: Path) =
    _watchService().get(path).getOrElse {
      val ws = path.getFileSystem().newWatchService()
      _watchService.send(_ + (path -> ws))
      ws
    }

  def receive = {
    case StopWatching =>
      shouldStop = true
    case StartWatching(pathName, recursive) =>
      shouldStop = false
      if (new File(pathName).exists) {
        start(Paths.get(pathName), recursive)
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
  def start(watchedPath: Path, recursive: Boolean): Unit = {
    changeHandler.onStart(watchedPath, recursive)
    updateTicker = Some(context.system.scheduler.schedule(TICKER_INTERVAL, TICKER_INTERVAL) {
      changeHandler.onTick(watchedPath, recursive)
    })
    watchFile(watchedPath, recursive)
  }

  /**
   * Print an event
   */
  def handleEvent(event: WatchEvent[_]): Unit = {
    val kind = event.kind
    val event_path = event.context().asInstanceOf[Path]
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
  def register(dir: Path, root: Option[Path] = None): Unit = {
    val ws = watchService(root getOrElse dir)
    val key = dir.register(ws, StandardWatchEventKinds.ENTRY_CREATE,
      StandardWatchEventKinds.ENTRY_MODIFY,
      StandardWatchEventKinds.ENTRY_DELETE)

    if (trace) {
      val prev = keys.getOrElse(key, null)
      if (prev == null) {
        println("register: " + dir)
      } else {
        if (!dir.equals(prev)) {
          println("update: " + prev + " -> " + dir)
        }
      }
    }

    keys(key) = dir
  }

  /**
   * Makes it easier to walk a file tree
   */
  implicit def makeDirVisitor(f: (Path) => Unit) = new SimpleFileVisitor[Path] {
    override def preVisitDirectory(p: Path, attrs: BasicFileAttributes) = {
      f(p)
      FileVisitResult.CONTINUE
    }
  }

  /**
   *  Recursively register directories
   */
  def registerAll(start: Path, root: Option[Path] = None): Unit = {
    Files.walkFileTree(start, (f: Path) => {
      register(f, root orElse Some(start))
    })
  }

  def watchFile(path: Path, recursive: Boolean) {
    try {
      if (recursive) {
        registerAll(path)
      } else {
        register(path)
      }

      trace = true
      Future {
        breakable {
          while (true) {
            val key = watchService(path).take()
            val dir = keys.getOrElse(key, null)
            if (dir != null) {
              key.pollEvents().asScala.foreach(event => {
                val kind = event.kind

                if (kind != StandardWatchEventKinds.OVERFLOW) {
                  val name = event.context().asInstanceOf[Path]
                  var child = dir.resolve(name)

                  handleEvent(event)

                  if (recursive && (kind == StandardWatchEventKinds.ENTRY_CREATE)) {
                    try {
                      if (Files.isDirectory(child, LinkOption.NOFOLLOW_LINKS)) {
                        registerAll(child, Some(path));
                      }
                    } catch {
                      case ioe: IOException =>
                        System.err.println("IOException: " + ioe)
                      case e: Exception =>
                        System.err.println("Exception: " + e)
                        break
                    }
                  }
                }
              })
            } else {
              println("WatchKey not recognized!!")
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
      case ie: InterruptedException =>
        System.err.println("InterruptedException: " + ie)
      case ioe: IOException =>
        System.err.println("IOException: " + ioe)
      case e: Exception =>
        System.err.println("Exception: " + e)
    }
  }

  override def postStop() = {
    super.postStop()
    shouldStop = true
    updateTicker.map(_.cancel())
  }
}