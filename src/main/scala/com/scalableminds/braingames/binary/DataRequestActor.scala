/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

import java.util.concurrent.TimeoutException

import com.scalableminds.braingames.binary.models.{DataLayer, DataLayerSection, DataSource, DataSourceRepository}
import com.scalableminds.braingames.binary.store._
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.geometry.{Point3D, Vector3D}
import com.scalableminds.util.tools.ExtendedTypes.{ExtendedArraySeq, ExtendedDouble}
import com.scalableminds.util.tools.Math._
import com.scalableminds.util.tools.{BlockedArray3D, Fox, FoxImplicits}
import com.typesafe.config.Config
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.concurrent.Execution.Implicits._
import scala.collection.breakOut

import scala.collection.mutable
import scala.concurrent._
import scala.concurrent.duration._

class LayerLocker extends FoxImplicits {

  case class LockObject(id: String)

  val lockObjects = mutable.HashMap.empty[String, LockObject]

  private def layer2String(dataSource: DataSource, layer: DataLayer) = {
    dataSource.id + "_#_" + layer.name
  }

  private def getLockObject(dataSource: DataSource, layer: DataLayer) = {
    val id = layer2String(dataSource, layer)
    lockObjects.synchronized {
      // TODO: currently we are creating new lock objects all the time, but they will never get removed from the map!
      // Think about an eviction strategy for unused layers
      lockObjects.getOrElseUpdate(id, LockObject(id))
    }
  }

  def withLockFor[A](dataSource: DataSource, layer: DataLayer)(f: () => A): A = {
    val lockObject = getLockObject(dataSource, layer)
    lockObject.synchronized(f())
  }
}

class DataRequester(
                     val conf: Config,
                     val cache: LRUConcurrentCache[CachedBlock, Array[Byte]],
                     dataSourceRepository: DataSourceRepository)
  extends DataCache
          with FoxImplicits
          with LazyLogging {

  val layerLocker = new LayerLocker

  implicit val dataBlockLoadTimeout = conf.getInt("loadTimeout").seconds

  implicit val dataBlockSaveTimeout = conf.getInt("saveTimeout").seconds

  lazy val dataStore: DataStore = new FileDataStore

  def requestCollection(coll: DataRequestCollection[DataRequest]): Fox[Array[Byte]] = {
    val resultsPromise = Fox.combined(coll.requests.map(load))
    resultsPromise.map(_.appendArrays)
  }

  def loadFromLayer(loadBlock: LoadBlock, useCache: Boolean): Fox[Array[Byte]] = {
    if (loadBlock.dataLayerSection.doesContainBlock(loadBlock.block, loadBlock.dataSource.blockLength, loadBlock.resolution)) {
      def loadFromStore: Fox[Array[Byte]] = Future {
        blocking {
          val bucket = dataStore.load(loadBlock)
            .futureBox
            .map {
              case f: Failure =>
                f.exception.map { e =>
                  logger.warn("Load from store failed: " + f.msg, e)
                }
                f
              case x =>
                x
            }
          Await.result(bucket, dataBlockLoadTimeout)
        }
      }.recover {
        case _: TimeoutException | _: InterruptedException =>
          logger.warn(s"Load from DS timed out. " +
                        s"(${loadBlock.dataSource.id }/${loadBlock.dataLayerSection.baseDir }, " +
                        s"Block: ${loadBlock.block })")
          Failure("dataStore.load.timeout")
      }

      if (useCache && !loadBlock.dataLayer.isUserDataLayer) {
        withCache(loadBlock)(loadFromStore)
      } else {
        loadFromStore
      }
    } else {
      Fox.empty
    }
  }

  def fallbackForLayer(layer: DataLayer): Future[List[(DataLayerSection, DataLayer)]] = {
    layer.fallback.toFox.flatMap { fallback =>
      dataSourceRepository.findUsableDataSource(fallback.dataSourceName).flatMap {
        d =>
          d.getDataLayer(fallback.layerName).map {
            fallbackLayer =>
              if (layer.isCompatibleWith(fallbackLayer))
                fallbackLayer.sections.map { (_, fallbackLayer) }
              else {
                logger.error(s"Incompatible fallback layer. $layer is not compatible with $fallbackLayer")
                Nil
              }
          }.toFox
      }
    }.getOrElse(Nil)
  }

  def loadFromSomewhere(dataSource: DataSource,
                        layer: DataLayer,
                        requestedSection: Option[String],
                        resolution: Int,
                        block: Point3D,
                        useCache: Boolean): Fox[Array[Byte]] = {
    var lastSection: Option[DataLayerSection] = None
    def loadFromSections(sections: Stream[(DataLayerSection, DataLayer)]): Fox[Array[Byte]] = sections match {
      case (section, layer) #:: tail =>
        lastSection = Some(section)
        val loadBlock = LoadBlock(dataSource, layer, section, resolution, block)
        loadFromLayer(loadBlock, useCache).futureBox.flatMap {
          case Full(byteArray) =>
            Fox.successful(byteArray)
          case f: Failure =>
            logger.error(s"DataStore Failure: ${f.msg}")
            Future.successful(f)
          case _ =>
            loadFromSections(tail)
        }
      case _ =>
        // We couldn't find the data in any section. Hence let's assume there is none
        Fox.successful(Array.empty[Byte])
    }

    val sections = Stream(layer.sections.map { (_, layer) }.filter {
      section =>
        requestedSection.forall(_ == section._1.sectionId)
    }: _*).append(Await.result(fallbackForLayer(layer), 5.seconds))

    loadFromSections(sections)
  }

  def loadBlocks(minBlock: Point3D,
                 maxBlock: Point3D,
                 dataRequest: DataRequest,
                 layer: DataLayer,
                 useCache: Boolean = true): Array[Fox[Array[Byte]]] = {
    loadBlocks(minBlock, maxBlock, dataRequest.dataSource, dataRequest.dataSection, dataRequest.resolution, layer, useCache)
  }

  def loadBlocks(minBlock: Point3D,
                 maxBlock: Point3D,
                 dataSource: DataSource,
                 dataSection: Option[String],
                 resolution: Int,
                 layer: DataLayer,
                 useCache: Boolean): Array[Fox[Array[Byte]]] = {
    (minBlock to maxBlock).toArray.map{
      p =>
        loadFromSomewhere(
                           dataSource,
                           layer,
                           dataSection,
                           resolution,
                           p,
                           useCache)
    }
  }

  def load(dataRequest: DataRequest): Fox[Array[Byte]] = {

    val cube = dataRequest.cuboid
    val dataSource = dataRequest.dataSource
    val layer = dataRequest.dataLayer
    val maxCorner = cube.bottomRight
    val minCorner = cube.topLeft

    val minPoint = Point3D(math.max(minCorner.x, 0), math.max(minCorner.y, 0), math.max(minCorner.z, 0))
    val minBlock = dataSource.pointToBlock(minPoint, dataRequest.resolution)
    val maxBlock = dataSource.pointToBlock(maxCorner, dataRequest.resolution)

    val pointOffset = minBlock.scale(dataSource.blockLength)

    dataRequest match {
      case request: DataReadRequest =>
        val combinedF: Fox[Array[Array[Byte]]] = Fox.combined(loadBlocks(minBlock, maxBlock, dataRequest, layer))
        combinedF.map {
          blocks =>
            BlockedArray3D(
                            blocks,
                            dataSource.blockLength, dataSource.blockLength, dataSource.blockLength,
                            maxBlock.x - minBlock.x + 1, maxBlock.y - minBlock.y + 1, maxBlock.z - minBlock.z + 1,
                            layer.bytesPerElement,
                            0.toByte)
        }.map {
          block =>
            new DataBlockCutter(block, request, layer, pointOffset).cutOutRequestedData
        }
      case request: DataWriteRequest =>
        Future(blocking(layerLocker.withLockFor(dataSource, layer)(() => synchronousSave(request,
                                                                                   layer,
                                                                                   minBlock,
                                                                                   maxBlock,
                                                                                   pointOffset))))
    }
  }

  def synchronousSave(
                       request: DataWriteRequest,
                       layer: DataLayer,
                       minBlock: Point3D,
                       maxBlock: Point3D,
                       pointOffset: Point3D): Box[Array[Byte]] = {
    try {
      val blockLength = request.dataSource.blockLength
      val f = Fox.combined(loadBlocks(minBlock, maxBlock, request, layer, useCache = false)).map {
        blocks =>
          BlockedArray3D(
                          blocks,
                          blockLength, blockLength, blockLength,
                          maxBlock.x - minBlock.x + 1, maxBlock.y - minBlock.y + 1, maxBlock.z - minBlock.z + 1,
                          layer.bytesPerElement,
                          0.toByte)
      }.flatMap {
        block =>
          val blocks = new DataBlockWriter(block, request, layer, pointOffset).writeSuppliedData
          saveBlocks(minBlock, maxBlock, request, layer, blocks).map(_ => Array.empty[Byte])
      }.futureBox

      // We will never wait here for ever, since all parts of the feature are upper bounded by Await.result on their own
      Await.result(f, Duration.Inf)
    } catch {
      case e: Exception =>
        logger.error(s"Saving block failed for. Error: $e")
        e.printStackTrace()
        Failure("dataStore.save.synchronousFailed", Full(e), Empty)
    }
  }

  def saveToLayer(saveBlock: SaveBlock): Fox[Boolean] = {

    def saveToStore: Fox[Boolean] = {
      Future {
        blocking {
          val saveResult = dataStore.save(saveBlock).futureBox
          Await.result(saveResult, dataBlockSaveTimeout)
        }
      }.recover {
        case _: TimeoutException | _: InterruptedException =>
          logger.warn(s"No response in time for block during save: " +
                        s"(${saveBlock.dataSource.id }/${saveBlock.dataLayerSection.baseDir } ${saveBlock.block })")
          Failure("dataStore.save.timeout")
      }
    }

    if (saveBlock.dataLayerSection.doesContainBlock(saveBlock.block, saveBlock.dataSource.blockLength, saveBlock.resolution)) {
      saveToStore
    } else {
      Fox.empty
    }
  }

  def saveToSomewhere(
                       dataSource: DataSource,
                       layer: DataLayer,
                       requestedSection: Option[String],
                       resolution: Int,
                       block: Point3D,
                       data: Array[Byte]): Fox[Boolean] = {

    def saveToSections(sections: List[DataLayerSection]): Fox[Boolean] = sections match {
      case section :: tail =>
        val saveBlock = SaveBlock(dataSource, layer, section, resolution, block, data)
        saveToLayer(saveBlock).futureBox.flatMap {
          case Full(r) => Future.successful(Full(r))
          case _ => saveToSections(tail)
        }
      case _ =>
        logger.error("Could not save userData to any section.")
        Fox.failure("dataStore.save.failedAllSections")
    }

    val sections = layer.sections.filter(section => requestedSection.forall(_ == section.sectionId))

    saveToSections(sections)
  }

  def saveBlocks(
                  minBlock: Point3D,
                  maxBlock: Point3D,
                  dataRequest: DataRequest,
                  layer: DataLayer,
                  blocks: Array[Array[Byte]]): Future[List[Box[Boolean]]] = {

    Fox.serialSequence((minBlock to maxBlock, blocks).zipped.toList) { case (point, block) =>
      if(block.length > 0) {
        saveToSomewhere(
                         dataRequest.dataSource,
                         layer,
                         dataRequest.dataSection,
                         dataRequest.resolution,
                         point,
                         block)
      } else
        Fox.successful(true)
    }
  }
}

class DataBlockCutter(block: BlockedArray3D[Byte], dataRequest: DataReadRequest, layer: DataLayer, offset: Point3D)
    extends CubeIterator {
  val dataSource = dataRequest.dataSource

  val resolution = dataRequest.resolution

  def cutOutRequestedData: Array[Byte] = {
    val result: Array[Byte] =
      iterateOverCube(dataRequest.cuboid, extendArrayBy = layer.bytesPerElement)(retrieveData)

    if (dataRequest.settings.useHalfByte)
      convertToHalfByte(result)
    else {
      result
    }
  }

  @inline
  private def retrieveData(px: Double, py: Double, pz: Double, idx: Int) = {
    byteLoader(Point3D(px.castToInt, py.castToInt, pz.castToInt))
  }

  private def convertToHalfByte(a: Array[Byte]) = {
    val aSize = a.length
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

  @inline
  private def calculatePositionInLoadedBlock(globalPoint: Point3D) = {
    dataSource.applyResolution(globalPoint, resolution).move(offset.negate)
  }

  @inline
  private def byteLoader(globalPoint: Point3D): Array[Byte] = {
    block(calculatePositionInLoadedBlock(globalPoint))
  }
}

class DataBlockWriter(block: BlockedArray3D[Byte], dataRequest: DataWriteRequest, layer: DataLayer, offset: Point3D)
 extends CubeIterator{
  val dataSource = dataRequest.dataSource

  val resolution = dataRequest.resolution

  def writeSuppliedData: Array[Array[Byte]] = {
    iterateOverCube(dataRequest.cuboid, extendArrayBy = layer.bytesPerElement)(writeData)
    block.underlying
  }

  @inline
  private def writeData(px: Double, py: Double, pz: Double, idx: Int): Array[Byte] = {
    byteWriter(Point3D(px.castToInt, py.castToInt, pz.castToInt), dataRequest.data, idx)
    Array.empty[Byte]
  }

  private def calculatePositionInLoadedBlock(globalPoint: Point3D): Point3D = {
    dataSource
      .applyResolution(globalPoint, resolution)
      .move(offset.negate)
  }

  @inline
  private def byteWriter(globalPoint: Point3D, data: Array[Byte], offset: Int): Unit = {
    block.setBytes(calculatePositionInLoadedBlock(globalPoint), data, offset)
  }
}