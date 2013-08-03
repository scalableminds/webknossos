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
import braingames.binary.SingleCubeRequest
import braingames.io.StartWatching
import java.io.File

trait BinaryDataService extends DataSetService{
  implicit def system: ActorSystem

  lazy implicit val executor = system.dispatcher

  def dataSetRepository: DataSetRepository

  val dataSetChangeHandler = new DataSetChangeHandler(dataSetRepository)

  def config: Config

  lazy implicit val timeout = Timeout(config.getInt("braingames.binary.loadTimeout") seconds) // needed for `?` below

  lazy val baseFolder = {
    new File(config.getString("braingames.binary.baseFolder")).getAbsolutePath
  }

  val scaleFactors = Array(1, 1, 1)

  lazy val dataRequestActor = {
    val bindataCache = Agent[Map[CachedBlock, Future[Box[Array[Byte]]]]](Map.empty)
    val props = Props(new DataRequestActor(
      config.getConfig("braingames.binary"),
      bindataCache,
      dataSetRepository))
    val nrOfBinRequestActors = config.getInt("braingames.binary.nrOfBinRequestActors")
    system.actorOf(props
      .withRouter(new RoundRobinRouter(nrOfBinRequestActors)), "dataRequestActor")
  }

  var directoryWatcher: Option[ActorRef] = None

  def   start(onComplete: => Unit = Unit) {
    val actor = system.actorOf(
      Props(new DirectoryWatcherActor(
        config.getConfig("braingames.binary.changeHandler"),
        dataSetChangeHandler)),
      name = "directoryWatcher")

    directoryWatcher = Some(actor)

    (actor ? StartWatching(baseFolder, true)).onComplete {
      case Success(x) =>
        onComplete
      case Failure(e) =>
        System.err.println(s"Failed to start watching $baseFolder: $e")
    }
  }

  def stop() {
    directoryWatcher.map(_ ! StopWatching)
  }

  def resolutionFromExponent(resolutionExponent: Int) =
    math.pow(2, resolutionExponent).toInt

  def cuboidFromPosition(position: Point3D, cubeSize: Int, resolution: Int) = {
    val cubeCorner = Vector3D(position.scale { (x,i) =>
        x - x % (cubeSize / scaleFactors(i))
    })
    Cuboid(cubeSize / scaleFactors(0), cubeSize / scaleFactors(1), cubeSize / scaleFactors(2), resolution, Some(cubeCorner))
  }

  def handleSingleCubeRequest(request: SingleCubeRequest) = {
    askDataRequestActor(request)
  }

  def handleMultiDataRequest(multi: MultipleDataRequest, dataSet: DataSet, dataLayer: DataLayerId, cubeSize: Int): Future[Option[Array[Byte]]] = {
    val cubeRequests = multi.requests.map { request =>
      val resolution = resolutionFromExponent(request.resolutionExponent)
      val cuboid = cuboidFromPosition(request.position, cubeSize, resolution)
      SingleCubeRequest(
        DataRequest(
          dataSet,
          dataLayer,
          resolution,
          cuboid,
          useHalfByte = request.useHalfByte,
          skipInterpolation = false))
    }

    askDataRequestActor(MultiCubeRequest(cubeRequests))
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