package braingames.binary.api

import akka.actor.ActorSystem
import akka.agent.Agent
import akka.actor.ActorRef
import com.typesafe.config.ConfigFactory
import braingames.binary.LoadBlock
import scala.concurrent.Future
import akka.actor.Props
import akka.pattern.ask
import braingames.binary.DataRequestActor
import akka.routing.RoundRobinRouter
import braingames.io.DirectoryWatcherActor
import braingames.io.DataSetChangeHandler
import akka.util.Timeout
import scala.concurrent.duration._
import braingames.geometry.Point3D
import braingames.geometry.Vector3D
import braingames.binary.Cuboid
import braingames.binary.models._
import scala.collection.mutable.ArrayBuffer
import braingames.binary.MultipleDataRequest
import braingames.binary.SingleRequest
import braingames.binary.DataRequest
import braingames.binary.MultiCubeRequest
import akka.pattern.AskTimeoutException

trait BinaryDataService {
  implicit val system: ActorSystem
  
  implicit val executor = system.dispatcher

  def dataSetChangeHandler: DataSetChangeHandler

  val config = ConfigFactory.load()

  implicit val timeout = Timeout(config.getInt("braingames.binary.loadTimeout") seconds) // needed for `?` below
  
  val scaleFactors = Array(1, 1, 1)
  
  lazy val dataRequestActor = {
    val nrOfBinRequestActors = config.getInt("braingames.binary.nrOfBinRequestActors")
    val bindataCache = Agent[Map[LoadBlock, Future[Array[Byte]]]](Map.empty)
    system.actorOf(Props(new DataRequestActor(config.getConfig("braingames.binary"), bindataCache))
      .withRouter(new RoundRobinRouter(nrOfBinRequestActors)), "dataRequestActor")
  }

  def start() {
    lazy val DirectoryWatcher = system.actorOf(
      Props(new DirectoryWatcherActor(
        config.getConfig("braingames.binary.changeHandler"),
        dataSetChangeHandler)),
      name = "directoryWatcher")
  }


  def resolutionFromExponent(resolutionExponent: Int) =
    math.pow(2, resolutionExponent).toInt

  def cuboidFromPosition(position: Point3D, cubeSize: Int, resolution: Int) = {
    val cubeCorner = Vector3D(position.scale {
      case (x, i) =>
        x - x % (cubeSize / scaleFactors(i))
    })
    Cuboid(cubeSize / scaleFactors(0), cubeSize / scaleFactors(1), cubeSize / scaleFactors(2), resolution, Some(cubeCorner))
  }

  def handleMultiDataRequest(multi: MultipleDataRequest, dataSet: DataSetLike, dataLayer: DataLayerLike, cubeSize: Int): Future[Option[ArrayBuffer[Byte]]] = {
    val cubeRequests = multi.requests.map { request =>
      val resolution = resolutionFromExponent(request.resolutionExponent)
      val cuboid = cuboidFromPosition(request.position, cubeSize, resolution)
      SingleRequest(
        DataRequest(
          dataSet,
          dataLayer,
          resolution,
          cuboid,
          useHalfByte = request.useHalfByte,
          skipInterpolation = true))
    }

    val future = (dataRequestActor ? MultiCubeRequest(cubeRequests)) recover {
      case e: AskTimeoutException =>
        println("WARN: Data request to DataRequestActor timed out!")
        None
    }

    future.mapTo[Option[ArrayBuffer[Byte]]]
  }
}