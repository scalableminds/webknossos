package braingames.binary

import akka.actor.Actor
import braingames.geometry.Point3D
import scala.collection.mutable.ArrayBuffer
import akka.agent.Agent
import akka.actor._
import akka.actor.ActorSystem
import braingames.geometry.Vector3D
import braingames.util.Math._
import akka.pattern.ask
import akka.pattern.AskTimeoutException
import akka.util.Timeout
import scala.util._
import scala.concurrent.duration._
import scala.concurrent.Future
import akka.pattern.pipe
import com.typesafe.config.ConfigFactory
import scala.collection.immutable.HashMap
import akka.routing.RoundRobinRouter
import java.util.UUID
import com.typesafe.config.Config
import braingames.binary.models.DataLayer
import braingames.binary.models.DataSet
import braingames.binary.models.DataLayerId
import store._
import braingames.binary.models.DataSetRepository
import scala.concurrent.Await
import scala.annotation.tailrec
import braingames.binary.models.DataLayerSection
import net.liftweb.common.Box
import net.liftweb.common.{ Failure => BoxFailure }
import net.liftweb.common.Full
import java.util.NoSuchElementException

class DataRequestActor(
  val conf: Config,
  val cache: Agent[Map[CachedBlock, Future[Option[Array[Byte]]]]],
  dataSetRepository: DataSetRepository)
    extends Actor
    with DataCache
    with EmptyDataProvider {

  import store.DataStore._
  
  val sys = context.system

  implicit val ec = context.dispatcher

  val id = UUID.randomUUID().toString()

  implicit val dataBlockLoadTimeout = Timeout((conf.getInt("loadTimeout")) seconds)

  // defines the maximum count of cached file handles
  val maxCacheSize = conf.getInt("cacheMaxSize")

  // defines how many file handles are deleted when the limit is reached
  val dropCount = conf.getInt("cacheDropCount")

  val remotePath = conf.getString("datarequest.remotepath")

  val useRemote = conf.getBoolean("useRemote")

  implicit val system =
    if (useRemote)
      ActorSystem("DataRequests", conf.getConfig("datarequest"))
    else
      context.system

  lazy val dataStores = List[ActorRef](
    actorForWithLocalFallback[FileDataStore]("fileDataStore")) //,
  //actorForWithLocalFallback[GridDataStore]("gridDataStore"),
  //system.actorOf(Props(new EmptyDataStore()).withRouter(new RoundRobinRouter(3)), s"${id}__emptyDataStore"))

  def actorForWithLocalFallback[T <: Actor](name: String)(implicit evidence: scala.reflect.ClassTag[T]) = {
    if (useRemote)
      system.actorFor(s"$remotePath/user/$name")
    else
      system.actorOf(Props[T].withRouter(new RoundRobinRouter(3)), s"${id}__${name}")
  }

  def receive = {
    case SingleCubeRequest(dataRequest) =>
      val s = sender
      Future {
        load(dataRequest) pipeTo s
      }
    case MultiCubeRequest(requests) =>
      val resultsPromise = Future.traverse(requests)(r =>
        load(r.dataRequest))
      val s = sender
      resultsPromise.onComplete {
        case Success(results) =>
          val size = results.map(_.size).sum
          s ! Some(results.foldLeft(new ArrayBuffer[Byte](size))(_ ++= _))
        case Failure(e) =>
          System.err.println(s"DataRequestActor Error for Request. Error: $e")
          s ! None
      }
  }

  def loadFromLayer(loadBlock: LoadBlock): Future[Option[Array[Byte]]] = {
    if (loadBlock.dataLayerSection.doesContainBlock(loadBlock.block, loadBlock.dataSet.blockLength)) {

      def loadFromStore(dataStores: List[ActorRef]): Future[Option[Array[Byte]]] = dataStores match {
        case a :: tail =>
          (a ? loadBlock)
            .mapTo[Option[Array[Byte]]]
            .flatMap { dataOpt =>
              dataOpt match {
                case d: Some[Array[Byte]] =>
                  Future.successful(d)
                case _ =>
                  loadFromStore(tail)
              }
            }.recoverWith {
              case e: AskTimeoutException =>
                println(s"WARN: (${loadBlock.dataSet.name}/${loadBlock.dataLayerSection.baseDir} ${loadBlock.block}) ${a.path}: Not response in time.")
                loadFromStore(tail)
            }
        case _ =>
          Future.successful(None)
      }

      withCache(loadBlock) {
        loadFromStore(dataStores)
      }
    } else {
      Future.successful(None)
    }
  }

  def loadFromSomewhere(dataSet: DataSet, layer: DataLayer, requestedLayer: DataLayerId, resolution: Int, block: Point3D): Future[Array[Byte]] = {

    def loadFromSections(sections: Stream[DataLayerSection]): Future[Array[Byte]] = sections match {
      case section #:: tail =>
        val loadBlock = LoadBlock(dataSet, layer, section, resolution, block)
        loadFromLayer(loadBlock).flatMap{
            case Some(byteArray) =>
              Future.successful(byteArray)
            case _ =>
              loadFromSections(tail)
        }
      case _ =>
        Future.successful(loadNullBlock(dataSet, layer))
    }

    val sections = Stream(layer.sections.filter { section =>
      requestedLayer.section.isEmpty || requestedLayer.section == section.sectionId
    }: _*).append {
      Await.result(dataSet.fallback.map(dataSetRepository.findByName).getOrElse(Future.successful(None)).map(_.flatMap { d =>
        d.dataLayer(requestedLayer.typ).map { fallbackLayer =>
          if (layer.isCompatibleWith(fallbackLayer))
            fallbackLayer.sections
          else {
            System.err.println("Incompatible fallback layer!")
            Nil
          }
        }
      }.getOrElse(Nil)), 5 seconds)
    }

    loadFromSections(sections)
  }

  def load(dataRequest: DataRequest): Future[ArrayBuffer[Byte]] = {

    val cube = dataRequest.cuboid

    val maxCorner = cube.maxCorner

    val minCorner = cube.minCorner

    val minPoint = Point3D(math.max(roundDown(minCorner._1), 0), math.max(roundDown(minCorner._2), 0), math.max(roundDown(minCorner._3), 0))

    val minBlock =
      dataRequest.dataSet.pointToBlock(minPoint, dataRequest.resolution)
    val maxBlock =
      dataRequest.dataSet.pointToBlock(
        Point3D(roundUp(maxCorner._1), roundUp(maxCorner._2), roundUp(maxCorner._3)),
        dataRequest.resolution)

    dataRequest.dataSet.dataLayer(dataRequest.dataLayer.typ) match {
      case Some(layer) =>

        val blocks = for {
          x <- minBlock.x to maxBlock.x
          y <- minBlock.y to maxBlock.y
          z <- minBlock.z to maxBlock.z
        } yield Point3D(x, y, z)

        Future.traverse(blocks) { p =>
          loadFromSomewhere(
            dataRequest.dataSet,
            layer,
            dataRequest.dataLayer,
            dataRequest.resolution,
            p).map(p -> _)
        }.map(HashMap() ++ _).map { blockMap =>

          @inline
          def interpolatedData(px: Double, py: Double, pz: Double) = {
            if (dataRequest.skipInterpolation)
              getBytes(dataRequest.dataSet)(Point3D(px.toInt, py.toInt, pz.toInt), 1, dataRequest.resolution, blockMap)
            else
              layer.interpolator.interpolate(dataRequest.resolution, blockMap, layer.bytesPerElement, getBytes(dataRequest.dataSet))(Vector3D(px, py, pz))
          }

          val result = cube.withContainingCoordinates(extendArrayBy = layer.bytesPerElement)(interpolatedData)

          if (dataRequest.useHalfByte)
            convertToHalfByte(result)
          else {
            result
          }
        }
      case _ =>
        Future.failed(new NoSuchElementException("Invalid dataLayer type"))
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

  def getBytes(dataSet: DataSet)(globalPoint: Point3D, bytesPerElement: Int, resolution: Int, blockMap: Map[Point3D, Array[Byte]]): Array[Byte] = {
    val block = dataSet.pointToBlock(globalPoint, resolution)
    blockMap.get(block) match {
      case Some(byteArray) =>
        getLocalBytes(dataSet, dataSet.globalToLocal(globalPoint, resolution), bytesPerElement, byteArray)
      case _ =>
        System.err.println(s"Didn't find block! :( -> $globalPoint -> $block")
        nullValue(bytesPerElement)
    }
  }

  def getLocalBytes(dataSet: DataSet, localPoint: Point3D, bytesPerElement: Int, data: Array[Byte]): Array[Byte] = {
    val address = (localPoint.x + localPoint.y * dataSet.blockLength + localPoint.z * dataSet.blockLength * dataSet.blockLength) * bytesPerElement
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
