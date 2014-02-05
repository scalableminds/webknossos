package braingames.binary.api

import akka.actor.ActorSystem
import akka.agent.Agent
import akka.actor.ActorRef
import braingames.binary._
import scala.concurrent.Future
import akka.actor.Props
import akka.pattern.ask
import akka.routing.RoundRobinRouter
import braingames.binary.watcher.DirectoryWatcherActor
import braingames.binary.watcher.DataSourceChangeHandler
import akka.util.Timeout
import scala.concurrent.duration._
import braingames.binary.models._
import akka.pattern.AskTimeoutException
import com.typesafe.config.Config
import net.liftweb.common.Box
import braingames.binary.watcher.StopWatching
import scala.util.Failure
import scala.Some
import scala.util.Success
import braingames.binary.watcher.StartWatching
import java.io.File

trait BinaryDataService extends DataSourceService with BinaryDataHelpers{
  import Logger._

  implicit def system: ActorSystem

  lazy implicit val executor = system.dispatcher

  def dataSourceRepository: DataSourceRepository

  val dataSourceChangeHandler = new DataSourceChangeHandler(dataSourceRepository)

  def config: Config

  lazy implicit val timeout = Timeout(config.getInt("braingames.binary.loadTimeout") seconds) // needed for `?` below

  lazy val baseFolder = {
    new File(config.getString("braingames.binary.baseFolder")).getAbsolutePath
  }

  val bindataCache = Agent[Map[CachedBlock, Future[Box[Array[Byte]]]]](Map.empty)

  lazy val dataRequestActor = {
    val nrOfBinRequestActors = config.getInt("braingames.binary.nrOfBinRequestActors")
    val props = Props(new DataRequestActor(
      config.getConfig("braingames.binary"),
      bindataCache,
      dataSourceRepository))

    system.actorOf(props
      .withRouter(new RoundRobinRouter(nrOfBinRequestActors)), "dataRequestActor")
  }

  var directoryWatcher: Option[ActorRef] = None

  def start(onComplete: => Unit = Unit) {
    val directoryWatcherConfig = config.getConfig("braingames.binary.changeHandler")
    val directoryWatcherActor =
      system.actorOf(
        Props(new DirectoryWatcherActor(directoryWatcherConfig, dataSourceChangeHandler)),
        name = "directoryWatcher")

    directoryWatcher = Some(directoryWatcherActor)

    (directoryWatcherActor ? StartWatching(baseFolder, true)).onComplete {
      case Success(x) =>
        onComplete
      case Failure(e) =>
        logger.error(s"Failed to start watching $baseFolder.", e)
    }
  }

  def stop() {
    directoryWatcher.map(_ ! StopWatching)
  }

  def handleDataRequest(request: AbstractDataRequest): Future[Option[Array[Byte]]] = {
    askDataRequestActor(request)
  }

  def askDataRequestActor[T](request: T) = {
    val future = (dataRequestActor ? request) recover {
      case e: AskTimeoutException =>
        logger.warn("Data request to DataRequestActor timed out!")
        None
    }

    future.mapTo[Option[Array[Byte]]]
  }
}