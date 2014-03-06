package braingames.binary.api

import akka.actor.ActorSystem
import akka.agent.Agent
import akka.actor.ActorRef
import braingames.binary._
import scala.concurrent.Future
import akka.actor.Props
import akka.pattern.ask
import akka.routing.RoundRobinRouter
import braingames.binary.watcher._
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
import scalax.file.Path
import braingames.util.PathUtils
import braingames.binary.repository.DataSourceRepositoryHandler

trait BinaryDataService extends DataSourceService with BinaryDataHelpers {

  import Logger._

  implicit def system: ActorSystem

  def dataSourceRepository: DataSourceRepository

  def config: Config

  lazy implicit val executor = system.dispatcher

  val dataSourceInboxHandler = new DataSourceRepositoryHandler(dataSourceRepository)

  lazy implicit val timeout = Timeout(config.getInt("braingames.binary.loadTimeout") seconds)

  lazy val dataSourceRepositoryDir = PathUtils.ensureDirectory(Path.fromString(config.getString("braingames.binary.baseFolder")))

  val binDataCache = Agent[Map[CachedBlock, Future[Box[Array[Byte]]]]](Map.empty)

  lazy val dataRequestActor = {
    val nrOfBinRequestActors = config.getInt("braingames.binary.nrOfBinRequestActors")
    val props = Props(classOf[DataRequestActor],
      config.getConfig("braingames.binary"),
      binDataCache,
      dataSourceRepository)

    system.actorOf(props
      .withRouter(new RoundRobinRouter(nrOfBinRequestActors)), "dataRequestActor")
  }

  var repositoryWatcher: Option[ActorRef] = None

  def start(onComplete: => Unit = Unit) {
    val repositoryWatcherConfig = config.getConfig("braingames.binary.changeHandler")
    val repositoryWatchActor =
      system.actorOf(
        Props(classOf[DirectoryWatcherActor], repositoryWatcherConfig, dataSourceInboxHandler),
        name = "directoryWatcher")

    repositoryWatcher = Some(repositoryWatchActor)

    (repositoryWatchActor ? StartWatching(dataSourceRepositoryDir, true)).onComplete {
      case Success(x) =>
        onComplete
      case Failure(e) =>
        logger.error(s"Failed to start watching ${dataSourceRepositoryDir.path}. ${e.getMessage}", e)
    }
  }

  def stop() {
    repositoryWatcher.map(_ ! StopWatching)
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