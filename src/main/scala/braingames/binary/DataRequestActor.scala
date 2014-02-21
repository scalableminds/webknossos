package braingames.binary

import braingames.geometry.Point3D
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
import akka.routing.RoundRobinRouter
import java.util.UUID
import com.typesafe.config.Config
import braingames.binary.models.DataLayer
import braingames.binary.models.DataSource
import store._
import braingames.binary.models.DataSourceRepository
import scala.concurrent.Await
import braingames.binary.models.DataLayerSection
import net.liftweb.common.Box
import net.liftweb.common.{Failure => BoxFailure}
import net.liftweb.common.Full
import java.util.NoSuchElementException
import braingames.util.{Fox, BlockedArray3D}
import braingames.util.ExtendedTypes.ExtendedArraySeq
import braingames.util.ExtendedTypes.ExtendedDouble

class DataRequestActor(
  val conf: Config,
  val cache: Agent[Map[CachedBlock, Future[Box[Array[Byte]]]]],
  dataSourceRepository: DataSourceRepository)
  extends Actor
  with DataCache
  with EmptyDataProvider {

  import Logger._

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
    case dataRequest: DataRequest =>
      val s = sender
      // This construct results in a parallel execution and catches all the errors
      Future.successful().flatMap{ _ =>
        load(dataRequest)
      }.onComplete{
        case Success(data) =>
          s ! Some(data)
        case Failure(e) =>
          logger.error(s"DataRequestActor error for request. Request: $dataRequest", e)
          s ! None
      }
    case DataRequestCollection(requests) =>
      val resultsPromise = Future.traverse(requests)(load)
      val s = sender
      resultsPromise.onComplete {
        case Success(results) =>
          s ! Some(results.appendArrays)
        case Failure(e) =>
          logger.error(s"DataRequestActor Error for request collection. Collection: $requests", e)
          s ! None
      }
  }

  def loadFromLayer(loadBlock: LoadBlock): Future[Box[Array[Byte]]] = {
    if (loadBlock.dataLayerSection.doesContainBlock(loadBlock.block, loadBlock.dataSource.blockLength)) {
      def loadFromStore(dataStores: List[ActorRef]): Future[Box[Array[Byte]]] = dataStores match {
        case a :: tail =>
          (a ? loadBlock)
            .mapTo[Box[Array[Byte]]]
            .flatMap {
            dataOpt =>
              dataOpt match {
                case d: Full[Array[Byte]] =>
                  Future.successful(d)
                case _ =>
                  loadFromStore(tail)
              }
          }.recoverWith {
            case e: AskTimeoutException =>
              logger.warn(s"Load from ${a.path} timed out. (${loadBlock.dataSource.name}/${loadBlock.dataLayerSection.baseDir}, Block: ${loadBlock.block})")
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

  def loadFromSomewhere(dataSource: DataSource, layer: DataLayer, requestedSection: Option[String], resolution: Int, block: Point3D): Future[Array[Byte]] = {
    var lastSection: Option[DataLayerSection] = None
    def loadFromSections(sections: Stream[(DataLayerSection, DataLayer)]): Future[Array[Byte]] = sections match {
      case (section, layer) #:: tail =>
        lastSection = Some(section)
        val loadBlock = LoadBlock(dataSource, layer, section, resolution, block)
        loadFromLayer(loadBlock).flatMap {
          case Full(byteArray) =>
            Future.successful(byteArray)
          case net.liftweb.common.Failure(e, _, _) =>
            logger.error(s"DataStore Failure: $e")
            loadFromSections(tail)
          case _ =>
            loadFromSections(tail)
        }
      case _ =>
        val nullBlock = loadNullBlock(dataSource, layer)
        lastSection.map {
          section =>
          val loadBlock = LoadBlock(dataSource, layer, section, resolution, block)
          updateCache(loadBlock, Future.successful(Full(nullBlock)))
        }
        Future.successful(nullBlock)
    }

    val sections = Stream(layer.sections.map {(_, layer)}.filter {
      section =>
        requestedSection.map( _ == section._1.sectionId) getOrElse true
    }: _*).append {
      Await.result(layer.fallback.map(dataSourceRepository.findByName).getOrElse(Fox.empty).futureBox.map(_.flatMap{
        d =>
          d.dataLayer(layer.typ).map {
            fallbackLayer =>
              if (layer.isCompatibleWith(fallbackLayer))
                fallbackLayer.sections.map {(_, fallbackLayer)}
              else {
                logger.error(s"Incompatible fallback layer. $layer is not compatible with $fallbackLayer")
                Nil
              }
          }
      }.getOrElse(Nil)), 5 seconds)
    }

    loadFromSections(sections)
  }

  def loadBlocks(minBlock: Point3D, maxBlock: Point3D, dataRequest: DataRequest, layer: DataLayer) = {
    val blockIdxs = for {
      x <- minBlock.x to maxBlock.x
      y <- minBlock.y to maxBlock.y
      z <- minBlock.z to maxBlock.z
    } yield Point3D(x, y, z)

    Future.traverse(blockIdxs) {
      p =>
        loadFromSomewhere(
          dataRequest.dataSource,
          layer,
          dataRequest.dataSection,
          dataRequest.resolution,
          p)
    }
  }

  def load(dataRequest: DataRequest): Future[Array[Byte]] = {

    val cube = dataRequest.cuboid

    val dataSource = dataRequest.dataSource

    val layer = dataRequest.dataLayer

    val maxCorner = cube.maxCorner

    val minCorner = cube.minCorner

    val minPoint = Point3D(math.max(roundDown(minCorner._1), 0), math.max(roundDown(minCorner._2), 0), math.max(roundDown(minCorner._3), 0))

    val minBlock =
      dataSource.pointToBlock(minPoint, dataRequest.resolution)
    val maxBlock =
      dataSource.pointToBlock(
        Point3D(roundUp(maxCorner._1), roundUp(maxCorner._2), roundUp(maxCorner._3)),
        dataRequest.resolution)

    val pointOffset = minBlock.scale(dataSource.blockLength)

    loadBlocks(minBlock, maxBlock, dataRequest, layer)
      .map {
      blocks =>
        BlockedArray3D(
          blocks.toVector,
          dataSource.blockLength, dataSource.blockLength, dataSource.blockLength,
          maxBlock.x - minBlock.x + 1, maxBlock.y - minBlock.y + 1, maxBlock.z - minBlock.z + 1,
          layer.bytesPerElement,
          0.toByte)
    }
      .map {
        block =>
          dataRequest match {
            case request: DataReadRequest =>
              new DataBlockCutter(block, request, layer, pointOffset).cutOutRequestedData
            case request: DataWriteRequest =>
              ensureCopyInCache(minBlock, maxBlock, dataRequest, layer, block.underlying).map { b =>
                val blocks = new DataBlockWriter(block.copy(underlying = b), request, layer, pointOffset).writeSuppliedData
                saveBlocks(minBlock, maxBlock, dataRequest, layer, blocks)
              }
              Array[Byte]()
          }
    }
  }

  def saveToLayer(saveBlock: SaveBlock): Future[Unit] = {
    if (saveBlock.dataLayerSection.doesContainBlock(saveBlock.block, saveBlock.dataSource.blockLength)) {
      def saveToStore(dataStores: List[ActorRef]): Future[Unit] = dataStores match {
        case a :: tail =>
          (a ? saveBlock).mapTo[Unit].recoverWith {
            case e: AskTimeoutException =>
              println(s"WARN: (${saveBlock.dataSource.name}/${saveBlock.dataLayerSection.baseDir} ${saveBlock.block}) ${a.path}: Not response in time.")
              saveToStore(tail)
          }
          Future.successful(Unit)
        case _ =>
          Future.successful(Unit)
      }

      saveToStore(dataStores)
    } else {
      Future.successful(Unit)
    }
  }

  def saveToSomewhere(dataSource: DataSource, layer: DataLayer, requestedSection: Option[String], resolution: Int, block: Point3D, data: Array[Byte]) = {

    def saveToSections(sections: Stream[DataLayerSection]): Future[Unit] = sections match {
      case section #:: tail =>
        val saveBlock = SaveBlock(dataSource, layer, section, resolution, block, data)
        saveToLayer(saveBlock).onFailure {
          case _ =>
            saveToSections(tail)
        }
        Future.successful(Unit)

      case _ =>
        System.err.println("Could not save userData to any section.")
        Future.successful()
    }

    val sections = Stream(layer.sections.filter {
      section =>
        requestedSection.map(_ == section.sectionId) getOrElse true
    }: _*)

    saveToSections(sections)
  }

  def saveBlocks(minBlock: Point3D, maxBlock: Point3D, dataRequest: DataRequest, layer: DataLayer, blocks: Vector[Array[Byte]]) = {
    val blockIdxs = for {
      x <- minBlock.x to maxBlock.x
      y <- minBlock.y to maxBlock.y
      z <- minBlock.z to maxBlock.z
    } yield Point3D(x, y, z)

    (blockIdxs, blocks).zipped foreach {
      (p, block) =>
        saveToSomewhere(
          dataRequest.dataSource,
          layer,
          dataRequest.dataSection,
          dataRequest.resolution,
          p,
          block)
    }
  }

    def ensureCopyInLayer(loadBlock: LoadBlock, data: Array[Byte]) = {
    withCache(loadBlock) {
      Future.successful(Full(data.clone))
    }
  }

  def ensureCopy(dataSource: DataSource, layer: DataLayer, requestedSection: Option[String], resolution: Int, block: Point3D, data: Array[Byte]) = {

    def ensureCopyInSections(sections: Stream[DataLayerSection]): Future[Array[Byte]] = sections match {
      case section #:: tail =>
        val loadBlock = LoadBlock(dataSource, layer, section, resolution, block)
        ensureCopyInLayer(loadBlock, data).flatMap {
          case Full(byteArray) =>
            Future.successful(byteArray)
          case _ =>
            ensureCopyInSections(tail)
        }

      case _ =>
        System.err.println("Could not ensure userData to be in cache.")
        Future.successful(Array[Byte]())
    }

    val sections = Stream(layer.sections.filter {
      section =>
        requestedSection.map(_ == section.sectionId) getOrElse true
    }: _*)

    ensureCopyInSections(sections)
  }

  def ensureCopyInCache(minBlock: Point3D, maxBlock: Point3D, dataRequest: DataRequest, layer: DataLayer, blocks: Vector[Array[Byte]]): Future[Vector[Array[Byte]]] = {
    val blockIdxs = for {
      x <- minBlock.x to maxBlock.x
      y <- minBlock.y to maxBlock.y
      z <- minBlock.z to maxBlock.z
    } yield Point3D(x, y, z)

    Future.sequence(
      (for {
        (p, block) <- (blockIdxs, blocks).zipped
      } yield {
        ensureCopy(
          dataRequest.dataSource,
          layer,
          dataRequest.dataSection,
          dataRequest.resolution,
          p,
          block)
      }).toVector
    )
  }
}

class DataBlockCutter(block: BlockedArray3D[Byte], dataRequest: DataReadRequest, layer: DataLayer, offset: Point3D) {
  val dataSource = dataRequest.dataSource

  val resolution = dataRequest.resolution

  val cube = dataRequest.cuboid

  @inline
  def interpolatedData(px: Double, py: Double, pz: Double, idx: Int) = {
    if (dataRequest.settings.skipInterpolation)
      byteLoader(Point3D(px.castToInt, py.castToInt, pz.castToInt))
    else
      layer.interpolator.interpolate(layer.bytesPerElement, byteLoader _)(Vector3D(px, py, pz))
  }

  def cutOutRequestedData = {
    val result: Array[Byte] =
      cube.withContainingCoordinates(extendArrayBy = layer.bytesPerElement)(interpolatedData)

    if (dataRequest.settings.useHalfByte)
      convertToHalfByte(result)
    else {
      result
    }
  }

  def convertToHalfByte(a: Array[Byte]) = {
    val aSize = a.size
    val compressedSize = if (aSize % 2 == 0) aSize / 2 else aSize / 2 + 1
    val compressed = new Array[Byte](compressedSize)
    var i = 0
    while (i * 2 + 1 < aSize) {
      val first = (a(i * 2) & 0xF0).toByte
      val second = (a(i * 2 + 1) & 0xF0).toByte >> 4 & 0x0F
      val value = (first | second).asInstanceOf[Byte]
      compressed(i) = value
      i += 1
    }
    compressed
  }

  def calculatePositionInLoadedBlock(globalPoint: Point3D) = {
    dataSource.applyResolution(globalPoint, resolution).move(offset.negate)
  }

  def byteLoader(globalPoint: Point3D): Array[Byte] = {
    block(calculatePositionInLoadedBlock(globalPoint))
  }

  def nullValue(bytesPerElement: Int) =
    new Array[Byte](bytesPerElement)
}

class DataBlockWriter(block: BlockedArray3D[Byte], dataRequest: DataWriteRequest, layer: DataLayer, offset: Point3D) {
  val dataSource = dataRequest.dataSource

  val resolution = dataRequest.resolution

  val cube = dataRequest.cuboid

  @inline
  def writeData(px: Double, py: Double, pz: Double, idx: Int) = {
    byteWriter(Point3D(px.castToInt, py.castToInt, pz.castToInt), dataRequest.data.slice(idx, idx + layer.bytesPerElement))
    Array[Byte]()
  }

  def writeSuppliedData = {
    cube.withContainingCoordinates(extendArrayBy = layer.bytesPerElement)(writeData)
    block.underlying
  }

  def calculatePositionInLoadedBlock(globalPoint: Point3D) = {
    dataSource.applyResolution(globalPoint, resolution).move(offset.negate)
  }

  def byteWriter(globalPoint: Point3D, data: Array[Byte]) = {
    block(calculatePositionInLoadedBlock(globalPoint), data)
  }
}