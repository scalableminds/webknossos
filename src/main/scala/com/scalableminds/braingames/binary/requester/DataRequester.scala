/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.handlers.{BlockHandler, KnossosBlockHandler, WebKnossosWrapBlockHandler}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{BlockedArray3D, Fox, FoxImplicits}
import com.typesafe.config.Config
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.concurrent.Execution.Implicits._

import scala.collection.mutable
import scala.concurrent._
import scala.concurrent.duration._

class LayerLocker extends FoxImplicits {

  case class LockObject(id: String)

  private val lockObjects = mutable.HashMap.empty[String, LockObject]

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

class DataCubeCache(val maxEntries: Int) extends LRUConcurrentCache[CachedBlock, Cube] {
  override def onElementRemoval(key: CachedBlock, value: Cube): Unit = {
    value.scheduleForRemoval()
  }
}

class DataRequester(
                     val conf: Config,
                     val cache: DataCubeCache,
                     dataSourceRepository: DataSourceRepository)
  extends FoxImplicits
    with LazyLogging {

  val layerLocker = new LayerLocker

  private implicit val dataBlockLoadTimeout = conf.getInt("loadTimeout").seconds

  private implicit val dataBlockSaveTimeout = conf.getInt("saveTimeout").seconds

  private def blockHandler(sourceType: Option[String]): BlockHandler = sourceType.getOrElse("knossos") match {
    case "knossos" =>
      new KnossosBlockHandler(cache)
    case "webKnossosWrap" =>
      new WebKnossosWrapBlockHandler(cache)
    case _ =>
      throw new Exception("Unexpected data layer type")
  }

  private def fallbackForLayer(layer: DataLayer): Future[List[(DataLayerSection, DataLayer)]] = {
    layer.fallback.toFox.flatMap { fallback =>
      dataSourceRepository.findUsableDataSource(fallback.dataSourceName).flatMap {
        d =>
          d.getDataLayer(fallback.layerName).map {
            fallbackLayer =>
              if (layer.isCompatibleWith(fallbackLayer))
                fallbackLayer.sections.map {
                  (_, fallbackLayer)
                }
              else {
                logger.error(s"Incompatible fallback layer. $layer is not compatible with $fallbackLayer")
                Nil
              }
          }.toFox
      }
    }.getOrElse(Nil)
  }

  private def emptyResult(request: DataRequest) =
    Fox.successful(new Array[Byte](request.cuboid.voxelVolume * request.dataLayer.bytesPerElement))

  def load(dataRequest: DataRequest): Fox[Array[Byte]] = {
    dataRequest match {
      case request: DataReadRequest =>
        val point = request.cuboid.topLeft
        if (point.x < 0 || point.y < 0 || point.z < 0) {
          emptyResult(request)
        } else {
          loadBlock(
            request.dataSource, request.dataLayer, request.dataSection,
            request.resolution, request.settings, point, useCache = true)
        }
      case request: DataWriteRequest =>
        Future(blocking(layerLocker.withLockFor(dataRequest.dataSource, dataRequest.dataLayer)(() =>
          synchronousSave(request, dataRequest.dataLayer, dataRequest.cuboid.topLeft))))
    }
  }

  def loadBlocks(minBlock: Point3D,
                 maxBlock: Point3D,
                 dataSource: DataSource,
                 dataSection: Option[String],
                 resolution: Int,
                 settings: DataRequestSettings,
                 layer: DataLayer,
                 useCache: Boolean): Array[Fox[Array[Byte]]] = {
    (minBlock to maxBlock).toArray.map {
      p =>
        loadBlock(
          dataSource,
          layer,
          dataSection,
          resolution,
          settings,
          p,
          useCache)
    }
  }


  def loadBlock(dataSource: DataSource,
                layer: DataLayer,
                requestedSection: Option[String],
                resolution: Int,
                settings: DataRequestSettings,
                block: Point3D,
                useCache: Boolean): Fox[Array[Byte]] = {
    var lastSection: Option[DataLayerSection] = None

    def loadFromSections(sections: Stream[(DataLayerSection, DataLayer)]): Fox[Array[Byte]] = sections match {
      case (section, layerOfSection) #:: tail =>
        lastSection = Some(section)
        val loadBlock = LoadBlock(dataSource, layerOfSection, section, resolution, settings, block)
        loadFromLayer(loadBlock, useCache).futureBox.flatMap {
          case Full(byteArray) =>
            Fox.successful(byteArray)
          case f: Failure =>
            logger.error(s"DataStore Failure: ${f.msg}")
            Fox.successful(Array.empty[Byte])
          case _ =>
            loadFromSections(tail)
        }
      case _ =>
        // We couldn't find the data in any section. Hence let's assume there is none
        Fox.successful(Array.empty[Byte])
    }

    val sections = Stream(layer.sections.map {
      (_, layer)
    }.filter {
      section =>
        requestedSection.forall(_ == section._1.sectionId)
    }: _*).append(Await.result(fallbackForLayer(layer), 5.seconds))

    loadFromSections(sections)
  }

  def loadFromLayer(loadBlock: LoadBlock, useCache: Boolean): Fox[Array[Byte]] = {
    if (loadBlock.dataLayerSection.doesContainBlock(loadBlock.block)) {
      val shouldCache = useCache && !loadBlock.dataLayer.isUserDataLayer
      blockHandler(loadBlock.dataLayer.sourceType).load(loadBlock, dataBlockLoadTimeout, shouldCache)
    } else {
      Fox.empty
    }
  }

  def synchronousSave(
                       request: DataWriteRequest,
                       layer: DataLayer,
                       block: Point3D): Box[Array[Byte]] = {
    try {
      val f = saveBlock(block, request, layer, request.data).map(_ => Array.empty[Byte]).futureBox

      // We will never wait here for ever, since all parts of the feature are upper bounded by Await.result on their own
      Await.result(f, Duration.Inf)
    } catch {
      case e: Exception =>
        logger.error(s"Saving block failed for. Error: $e")
        e.printStackTrace()
        Failure("dataStore.save.synchronousFailed", Full(e), Empty)
    }
  }

  def saveBlock(
                 block: Point3D,
                 request: DataRequest,
                 layer: DataLayer,
                 modifiedData: Array[Byte]): Fox[Boolean] = {

    def saveToSections(sections: List[DataLayerSection]): Fox[Boolean] = sections match {
      case section :: tail =>
        val saveBlock = SaveBlock(request.dataSource, layer, section, request.resolution, block, modifiedData)
        saveToLayer(saveBlock).futureBox.flatMap {
          case Full(r) => Future.successful(Full(r))
          case _ => saveToSections(tail)
        }
      case _ =>
        logger.error("Could not save userData to any section.")
        Fox.failure("dataStore.save.failedAllSections")
    }

    val sections = layer.sections.filter(section => request.dataSection.forall(_ == section.sectionId))

    saveToSections(sections)
  }

  def saveToLayer(saveBlock: SaveBlock): Fox[Boolean] = {
    if (saveBlock.dataLayerSection.doesContainBlock(saveBlock.block)) {
      blockHandler(saveBlock.dataLayer.sourceType).save(saveBlock, dataBlockSaveTimeout)
    } else {
      Fox.empty
    }
  }
}
