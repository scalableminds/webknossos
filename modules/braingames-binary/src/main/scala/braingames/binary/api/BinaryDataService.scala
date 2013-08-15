package braingames.binary.api

import akka.actor.ActorSystem
import akka.agent.Agent
import akka.actor.ActorRef
import com.typesafe.config.ConfigFactory
import braingames.binary._
import scala.concurrent.Future
import akka.actor.Props
import akka.pattern.ask
import akka.routing.RoundRobinRouter
import braingames.io.DirectoryWatcherActor
import braingames.io.DataSetChangeHandler
import akka.util.Timeout
import scala.concurrent.duration._
import braingames.geometry.Point3D
import braingames.geometry.Vector3D
import braingames.binary.models._
import scala.collection.mutable.ArrayBuffer
import akka.pattern.AskTimeoutException
import braingames.io.StopWatching
import braingames.io.StartWatching
import scala.util.Success
import scala.util.Failure
import com.typesafe.config.Config
import braingames.binary.models.DataLayerId
import net.liftweb.common.Box
import braingames.io.StopWatching
import braingames.binary.models.DataLayerId
import scala.util.Failure
import scala.Some
import scala.util.Success
import braingames.binary.models.DataSet
import braingames.io.StartWatching
import braingames.io.StopWatching
import braingames.binary.models.DataLayerId
import scala.util.Failure
import scala.Some
import braingames.binary.DataRequest
import braingames.binary.Cuboid
import scala.util.Success
import braingames.binary.models.DataSet
import braingames.io.StartWatching
import java.io.File

trait BinaryDataService extends DataSetService with BinaryDataHelpers{
  implicit def system: ActorSystem

  lazy implicit val executor = system.dispatcher

  def dataSetRepository: DataSetRepository

  val dataSetChangeHandler = new DataSetChangeHandler(dataSetRepository)

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
      dataSetRepository))

    system.actorOf(props
      .withRouter(new RoundRobinRouter(nrOfBinRequestActors)), "dataRequestActor")
  }

  var directoryWatcher: Option[ActorRef] = None

  def start(onComplete: => Unit = Unit) {
    val directoryWatcherConfig = config.getConfig("braingames.binary.changeHandler")
    val directoryWatcherActor =
      system.actorOf(
        Props(new DirectoryWatcherActor(directoryWatcherConfig, dataSetChangeHandler)),
        name = "directoryWatcher")

    directoryWatcher = Some(directoryWatcherActor)

    (directoryWatcherActor ? StartWatching(baseFolder, true)).onComplete {
      case Success(x) =>
        onComplete
      case Failure(e) =>
        System.err.println(s"Failed to start watching $baseFolder: $e")
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
        println("WARN: Data request to DataRequestActor timed out!")
        None
    }

    future.mapTo[Option[Array[Byte]]]
  }
}