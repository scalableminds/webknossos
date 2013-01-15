package brainflight.binary

import akka.actor.Actor
import brainflight.tools.geometry.Point3D
import models.binary._
import scala.collection.mutable.ArrayBuffer
import akka.agent.Agent
import play.api.Logger
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor._
import play.api.libs.concurrent.Promise
import play.api.libs.concurrent.Execution.Implicits._
import akka.actor.ActorSystem
import brainflight.tools.geometry.Vector3D
import brainflight.tools.Math._
import akka.pattern.ask
import akka.pattern.AskTimeoutException
import akka.util.Timeout
import scala.util._
import scala.concurrent.duration._
import scala.concurrent.Future
import akka.pattern.pipe
import com.typesafe.config.ConfigFactory
import play.api.Play
import brainflight.ActorSystems
import scala.collection.immutable.HashMap
import akka.routing.RoundRobinRouter

case class SingleRequest(dataRequest: DataRequest)
case class MultiCubeRequest(requests: Seq[SingleRequest])

class DataRequestActor extends Actor with DataCache {
  import DataStore._

  implicit val dataBlockLoadTimeout = Timeout(10 seconds)
  val conf = Play.current.configuration
  val remotePath = conf.getString("datarequest.remotepath").getOrElse("")
  val useRemote = conf.getBoolean("bindata.useRemote").getOrElse(false)
  implicit val system =
    if (useRemote)
      ActorSystems.dataRequestSystem
    else
      context.system

  lazy val dataStores = List[ActorRef](
    actorForWithLocalFallback[FileDataStore]("fileDataStore"),
    actorForWithLocalFallback[GridDataStore]("gridDataStore"),
    system.actorOf(Props(new EmptyDataStore()), name = "emptyDataStore"))

  def actorForWithLocalFallback[T <: Actor](name: String)(implicit evidence: scala.reflect.ClassTag[T]) = {
    if (useRemote)
      system.actorFor(s"$remotePath/user/$name")
    else
      system.actorOf(Props[T], name = name)
  }

  def receive = {
    case SingleRequest(dataRequest) =>
      load(dataRequest) pipeTo sender
    case MultiCubeRequest(requests) =>
      val resultsPromise = Future.traverse(requests)(r =>
        load(r.dataRequest))
      val s = sender
      resultsPromise.onComplete {
        case Success(results) =>
          val size = results.map(_.size).sum
          s ! results.foldLeft(new ArrayBuffer[Byte](size))(_ ++= _)
        case Failure(e) =>
          Logger.error(s"DataRequestActor Error for Request. Error: $e")
      }
  }

  def loadFromSomewhere(dataSet: DataSet, dataLayer: DataLayer, resolution: Int, block: Point3D) = {
    val block2Load = LoadBlock(dataSet.baseDir, dataSet.name, dataLayer.folder, dataLayer.bytesPerElement, resolution, block.x, block.y, block.z)

    def loadFromStore(dataStores: List[ActorRef]): Future[Array[Byte]] = dataStores match {
      case a :: tail =>
        Logger.trace(s"Sending request: $block to ${a.path}")
        (a ? block2Load).mapTo[Array[Byte]].recoverWith {
          case e: AskTimeoutException =>
            Logger.warn(s"(${dataSet.name}/${dataLayer.folder} $block) ${a.path}: Not response in time.")
            loadFromStore(tail)
          case e: ClassCastException =>
            // TODO: find a better way to catch the DataNotFoundException
            Logger.warn(s"(${dataSet.name}/${dataLayer.folder} $block) ${a.path}: Not found.")
            loadFromStore(tail)
        }
      case _ =>
        throw new DataNotFoundException("DataSetActor")
    }

    withCache(block2Load) {
      loadFromStore(dataStores)
    }
  }

  def pointToBlock(point: Point3D, resolution: Int) =
    Point3D(
      point.x / blockLength / resolution,
      point.y / blockLength / resolution,
      point.z / blockLength / resolution)

  def globalToLocal(point: Point3D, resolution: Int) =
    Point3D(
      (point.x / resolution) % blockLength,
      (point.y / resolution) % blockLength,
      (point.z / resolution) % blockLength)

  def load(dataRequest: DataRequest): Future[ArrayBuffer[Byte]] = {

    val cube = dataRequest.cuboid

    val maxCorner = cube.maxCorner

    val minCorner = cube.minCorner

    val minPoint = Point3D(math.max(roundDown(minCorner._1), 0), math.max(roundDown(minCorner._2), 0), math.max(roundDown(minCorner._3), 0))

    val minBlock = pointToBlock(minPoint, dataRequest.resolution)
    val maxBlock = pointToBlock(Point3D(roundUp(maxCorner._1), roundUp(maxCorner._2), roundUp(maxCorner._3)), dataRequest.resolution)

    val blocks = for {
      x <- minBlock.x to maxBlock.x
      y <- minBlock.y to maxBlock.y
      z <- minBlock.z to maxBlock.z
    } yield Point3D(x, y, z)

    Future.traverse(blocks) { p =>
      loadFromSomewhere(
        dataRequest.dataSet,
        dataRequest.layer,
        dataRequest.resolution,
        p).map(p -> _)
    }.map(HashMap() ++ _).map { blockMap =>

      @inline
      def interpolatedData(px: Double, py: Double, pz: Double) = {
        if (dataRequest.skipInterpolation)
          getBytes(Point3D(px.toInt, py.toInt, pz.toInt), 1, dataRequest.resolution, blockMap)
        else
          dataRequest.layer.interpolate(dataRequest.resolution, blockMap, getBytes _)(Vector3D(px, py, pz))
      }

      val result = cube.withContainingCoordinates(extendArrayBy = dataRequest.layer.bytesPerElement)(interpolatedData)

      if (dataRequest.useHalfByte)
        convertToHalfByte(result)
      else {
        result
      }
    }
  }

  def convertToHalfByte(a: ArrayBuffer[Byte]) = {
    val aSize = a.size
    val compressedSize = if (aSize % 2 == 0) aSize / 2 else aSize / 2 + 1
    val compressed = new ArrayBuffer[Byte](compressedSize)
    var i = 0
    while (i * 2 + 1 < aSize) {
      val first = (a(i * 2) & 0xF0).toByte
      val second = (a(i * 2 + 1) & 0xF0).toByte >> 4 & 0x0F
      val value = (first | second).asInstanceOf[Byte]
      compressed += value
      i += 1
    }
    compressed
  }

  def getBytes(globalPoint: Point3D, bytesPerElement: Int, resolution: Int, blockMap: Map[Point3D, Array[Byte]]): Array[Byte] = {
    val block = pointToBlock(globalPoint, resolution)
    blockMap.get(block) match {
      case Some(byteArray) =>
        getLocalBytes(globalToLocal(globalPoint, resolution), bytesPerElement, byteArray)
      case _ =>
        Logger.error("Didn't find block! :(")
        nullValue(bytesPerElement)
    }
  }

  def getLocalBytes(localPoint: Point3D, bytesPerElement: Int, data: Array[Byte]): Array[Byte] = {
    val address = (localPoint.x + localPoint.y * blockLength + localPoint.z * blockLength * blockLength) * bytesPerElement
    val bytes = new Array[Byte](bytesPerElement)
    var i = 0
    while (i < bytesPerElement) {
      bytes.update(i, data(address + i))
      i += 1
    }
    bytes
  }

  def nullValue(bytesPerElement: Int) =
    new Array[Byte](bytesPerElement)
} 
