/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

import akka.routing.RoundRobinPool
import com.scalableminds.util.geometry.Point3D
import akka.agent.Agent
import akka.actor._
import akka.actor.ActorSystem
import com.scalableminds.util.geometry.Vector3D
import com.scalableminds.util.tools.Math._
import akka.pattern.ask
import akka.pattern.AskTimeoutException
import akka.util.Timeout

import scala.util._
import scala.concurrent.duration._
import scala.concurrent.Future
import java.util.UUID

import com.typesafe.config.Config
import com.scalableminds.braingames.binary.models.DataLayer
import com.scalableminds.braingames.binary.models.DataSource
import store._
import com.scalableminds.braingames.binary.models.DataSourceRepository

import scala.concurrent.Await
import com.scalableminds.braingames.binary.models.DataLayerSection
import net.liftweb.common.Box
import net.liftweb.common.{Failure => BoxFailure}
import net.liftweb.common.Full
import java.util.NoSuchElementException

import scala.concurrent.Lock
import com.scalableminds.util.tools.{BlockedArray3D, Fox, FoxImplicits}
import com.scalableminds.util.tools.ExtendedTypes.ExtendedArraySeq
import com.scalableminds.util.tools.ExtendedTypes.ExtendedDouble
import com.typesafe.scalalogging.LazyLogging

class DataRequestActor(
  val conf: Config,
  val cache: Agent[Map[CachedBlock, Future[Box[Array[Byte]]]]],
  dataSourceRepository: DataSourceRepository)
  extends Actor
          with DataCache
          with FoxImplicits
          with EmptyDataProvider
          with LazyLogging {

  import store.DataStore._

  val sys = context.system

  val writeLock = new Lock()

  implicit val ec = context.dispatcher

  val id = UUID.randomUUID().toString()

  implicit val dataBlockLoadTimeout = Timeout((conf.getInt("loadTimeout")) seconds)
  implicit val dataBlockSaveTimeout = (conf.getInt("loadTimeout")) seconds

  // defines the maximum count of cached file handles
  val maxCacheSize = conf.getInt("cacheMaxSize")

  // defines how many file handles are deleted when the limit is reached
  val dropCount = conf.getInt("cacheDropCount")

  implicit val system = context.system

  lazy val dataStores = List[ActorRef](
    system.actorOf(Props[FileDataStoreActor].withRouter(new RoundRobinPool(3)), s"${id}__fileDataStore")
  )

  def receive = {
    case dataRequest: DataRequest =>
      val s = sender
      // This construct results in a parallel execution and catches all the errors
      Future.successful(true).flatMap{ _ =>
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

  def loadFromLayer(loadBlock: LoadBlock, useCache: Boolean): Future[Box[Array[Byte]]] = {
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
                case f: net.liftweb.common.Failure =>
                  f.exception.map{e =>
                    logger.warn("Load from store failed: " + f.msg, e)
                  } getOrElse {
                    logger.warn("Load from store failed: " + f.msg)
                  }
                  loadFromStore(tail)
                case _ =>
                  loadFromStore(tail)
              }
          }.recoverWith {
            case e: AskTimeoutException =>
              logger.warn(s"Load from ${a.path} timed out. (${loadBlock.dataSource.id}/${loadBlock.dataLayerSection.baseDir}, Block: ${loadBlock.block})")
              loadFromStore(tail)
          }
        case _ =>
          Future.successful(None)
      }

      if (useCache && !loadBlock.dataLayer.isUserDataLayer) {
        withCache(loadBlock) {
          loadFromStore(dataStores)
        }
      } else {
        loadFromStore(dataStores)
      }
    } else {
      Future.successful(None)
    }
  }

  def fallbackForLayer(layer: DataLayer): Future[List[(DataLayerSection, DataLayer)]] = {
    layer.fallback.toFox.flatMap{ fallback =>
      dataSourceRepository.findUsableDataSource(fallback.dataSourceName).flatMap{
        d =>
          d.getDataLayer(fallback.layerName).map {
            fallbackLayer =>
              if (layer.isCompatibleWith(fallbackLayer))
                fallbackLayer.sections.map {(_, fallbackLayer)}
              else {
                logger.error(s"Incompatible fallback layer. $layer is not compatible with $fallbackLayer")
                Nil
              }
          }.toFox
      }
    }.getOrElse(Nil)
  }

  def loadFromSomewhere(dataSource: DataSource, layer: DataLayer, requestedSection: Option[String], resolution: Int, block: Point3D, useCache: Boolean): Future[Array[Byte]] = {
    var lastSection: Option[DataLayerSection] = None
    def loadFromSections(sections: Stream[(DataLayerSection, DataLayer)]): Future[Array[Byte]] = sections match {
      case (section, layer) #:: tail =>
        lastSection = Some(section)
        val loadBlock = LoadBlock(dataSource, layer, section, resolution, block)
        loadFromLayer(loadBlock, useCache).flatMap {
          case Full(byteArray) =>
            Future.successful(byteArray)
          case net.liftweb.common.Failure(e, _, _) =>
            logger.error(s"DataStore Failure: $e")
            loadFromSections(tail)
          case _ =>
            loadFromSections(tail)
        }
      case _ =>
        Future.successful(loadNullBlock(dataSource, layer, useCache))
    }

    val sections = Stream(layer.sections.map{(_, layer)}.filter {
      section =>
        requestedSection.map( _ == section._1.sectionId) getOrElse true
    }: _*).append(Await.result(fallbackForLayer(layer), 5 seconds))

    loadFromSections(sections)
  }

  def loadBlocks(minBlock: Point3D, maxBlock: Point3D, dataRequest: DataRequest, layer: DataLayer, useCache: Boolean = true) = {
    Future.traverse(minBlock to maxBlock) {
      p =>
        loadFromSomewhere(
          dataRequest.dataSource,
          layer,
          dataRequest.dataSection,
          dataRequest.resolution,
          p,
          useCache)
    }
  }

  def withLock[T](f: => Future[T]): Future[T] = {
    writeLock.acquire()
    val r = f
    r.onComplete { result =>
      if(result.isFailure)
        logger.error(s"Saving block failed for. Error: $result")
      writeLock.release()
    }
    r
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

    dataRequest match {
      case request: DataReadRequest =>
        loadBlocks(minBlock, maxBlock, dataRequest, layer).map {
          blocks =>
            BlockedArray3D(
              blocks.toVector,
              dataSource.blockLength, dataSource.blockLength, dataSource.blockLength,
              maxBlock.x - minBlock.x + 1, maxBlock.y - minBlock.y + 1, maxBlock.z - minBlock.z + 1,
              layer.bytesPerElement,
              0.toByte)
        }.map{
          block =>
            new DataBlockCutter(block, request, layer, pointOffset).cutOutRequestedData
        }
      case request: DataWriteRequest =>
        withLock {
          loadBlocks(minBlock, maxBlock, dataRequest, layer, useCache = false).map {
            blocks =>
              BlockedArray3D(
                blocks.toVector,
                dataSource.blockLength, dataSource.blockLength, dataSource.blockLength,
                maxBlock.x - minBlock.x + 1, maxBlock.y - minBlock.y + 1, maxBlock.z - minBlock.z + 1,
                layer.bytesPerElement,
                0.toByte)
          }.flatMap {
            block =>
              val blocks = new DataBlockWriter(block, request, layer, pointOffset).writeSuppliedData
              Future.sequence(saveBlocks(minBlock, maxBlock, dataRequest, layer, blocks, writeLock)).map {
                _ => Array[Byte]()
              }
          }
        }
    }
  }

  def saveToLayer(saveBlock: SaveBlock): Future[Unit] = {

    def saveToStore(dataStores: List[ActorRef]): Future[Unit] = dataStores match {
      case a :: tail =>
        val future = (a ? saveBlock).mapTo[Unit].recoverWith {
          case e: AskTimeoutException =>
            logger.warn(s"No response in time for block: (${saveBlock.dataSource.id}/${saveBlock.dataLayerSection.baseDir} ${saveBlock.block}) ${a.path}")
            saveToStore(tail)
        }
        Await.result(future, dataBlockSaveTimeout)
        Future.successful(Unit)
      case _ =>
        Future.successful(Unit)
    }

    if (saveBlock.dataLayerSection.doesContainBlock(saveBlock.block, saveBlock.dataSource.blockLength)) {
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
        logger.error("Could not save userData to any section.")
        Future.successful(Unit)
    }

    val sections = Stream(layer.sections.filter {
      section =>
        requestedSection.forall(_ == section.sectionId)
    }: _*)

    saveToSections(sections)
  }

  def saveBlocks(minBlock: Point3D, maxBlock: Point3D, dataRequest: DataRequest, layer: DataLayer, blocks: Vector[Array[Byte]], writeLock: Lock) = {
    (minBlock to maxBlock, blocks).zipped map {
      (point, block) =>
        saveToSomewhere(
          dataRequest.dataSource,
          layer,
          dataRequest.dataSection,
          dataRequest.resolution,
          point,
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
        logger.error("Could not ensure userData to be in cache.")
        Future.successful(Array[Byte]())
    }

    val sections = Stream(layer.sections.filter {
      section =>
        requestedSection.forall(_ == section.sectionId)
    }: _*)

    ensureCopyInSections(sections)
  }

  def ensureCopyInCache(minBlock: Point3D, maxBlock: Point3D, dataRequest: DataRequest, layer: DataLayer, blocks: Vector[Array[Byte]]): Future[Vector[Array[Byte]]] = {
    Future.sequence(
      (for {
        (p, block) <- (minBlock to maxBlock, blocks).zipped
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