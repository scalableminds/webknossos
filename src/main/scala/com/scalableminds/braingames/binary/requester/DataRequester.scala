/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester

import com.scalableminds.braingames.binary.formats.wkw.WebKnossosWrapDataSourceType
import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.handlers.{BucketHandler, KnossosBucketHandler, WebKnossosWrapBucketHandler}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
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

class DataCubeCache(val maxEntries: Int) extends LRUConcurrentCache[CachedCube, Fox[Cube]] {
  override def onElementRemoval(key: CachedCube, value: Fox[Cube]): Unit = {
    value.map(_.scheduleForRemoval())
  }
}

class DataRequester(
  val conf: Config,
  val cache: DataCubeCache,
  dataSourceRepository: DataSourceRepository)
  extends DataReadRequester
    with FoxImplicits
    with LazyLogging {

  val layerLocker = new LayerLocker

  private implicit val dataLoadTimeout = conf.getInt("loadTimeout").seconds

  private implicit val dataSaveTimeout = conf.getInt("saveTimeout").seconds

  private def fallbackForLayer(layer: DataLayer): Future[List[(DataLayerSection, DataLayer)]] = {
    layer.fallback.map { fallback =>
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
          }
      }.getOrElse(Nil)
    }.getOrElse(Future.successful(Nil))
  }

  private def emptyResult(bucket: BucketPosition, request: DataReadRequest) = {
    val halfByteFactor = if(request.settings.useHalfByte) 2 else 1
    Fox.successful(new Array[Byte](bucket.volume * request.dataLayer.bytesPerElement / halfByteFactor))
  }

  protected def handleBucketReadRequest(bucket: BucketPosition, request: DataReadRequest) = {
    val point = request.cuboid.topLeft
    if (point.x < 0 || point.y < 0 || point.z < 0) {
      emptyResult(bucket, request)
    } else {
      loadBucketOfRequest(bucket, request, useCache = true)
    }
  }

  def handleReadRequest(request: DataReadRequest): Fox[Array[Byte]] = {
    def isSingleBucketRequest = {
      request.cuboid.width == request.dataSource.lengthOfLoadedBuckets &&
        request.cuboid.height == request.dataSource.lengthOfLoadedBuckets &&
        request.cuboid.depth == request.dataSource.lengthOfLoadedBuckets &&
        request.cuboid.topLeft == request.cuboid.topLeft.toBucket(request.dataSource.lengthOfLoadedBuckets).topLeft
    }

    if (isSingleBucketRequest) {
      request.cuboid.allBucketsInCuboid(request.dataSource.lengthOfLoadedBuckets).headOption.toFox.flatMap { bucket =>
        handleBucketReadRequest(bucket, request)
      }
    } else {
      requestCuboidData(request)
    }
  }

  def handleWriteRequest(request: DataWriteRequest): Fox[Array[Byte]] = {
    Future(blocking(layerLocker.withLockFor(request.dataSource, request.dataLayer){() =>
      // TODO: hacky (we are not using bucket length here). This assumes the data requester can handle the request!
      val bucket = request.cuboid.topLeft.toBucket(request.cuboid.width)
      synchronousSave(request, request.dataLayer, bucket)
    }))
  }


  def loadBucketOfRequest(bucket: BucketPosition, request: DataReadRequest, useCache: Boolean): Fox[Array[Byte]] = {
    var lastSection: Option[DataLayerSection] = None

    def loadFromSections(sections: List[(DataLayerSection, DataLayer)]): Fox[Array[Byte]] = sections match {
      case (section, layerOfSection) :: tail =>
        lastSection = Some(section)
        val bucketRead = BucketReadInstruction(request.dataSource, layerOfSection, section, bucket, request.settings)
        loadFromLayer(bucketRead, useCache).futureBox.flatMap {
          case Full(byteArray) =>
            Fox.successful(byteArray)
          case f: Failure =>
            logger.error(s"DataStore Failure: ${f.msg}")
            emptyResult(bucket, request)
          case _ =>
            loadFromSections(tail)
        }
      case _ =>
        // We couldn't find the data in any section. Hence let's assume there is none
        emptyResult(bucket, request)
    }

    fallbackForLayer(request.dataLayer).toFox.flatMap { fallback =>
      val sections = request.dataLayer.sections
        .map {(_, request.dataLayer)}
        .filter { section => request.dataSection.forall(_ == section._1.sectionId) } ::: fallback

      loadFromSections(sections)
    }
  }

  private def loadFromLayer(bucketRead: BucketReadInstruction, useCache: Boolean): Fox[Array[Byte]] = {
    if (bucketRead.dataLayerSection.doesContainBucket(bucketRead.position)) {
      val shouldCache = useCache && !bucketRead.dataLayer.isUserDataLayer
      bucketRead.dataLayer.bucketHandler(cache).load(bucketRead, dataLoadTimeout, shouldCache)
    } else {
      Fox.empty
    }
  }

  def synchronousSave(
    request: DataWriteRequest,
    layer: DataLayer,
    bucket: BucketPosition): Box[Array[Byte]] = {

    try {
      val f = saveBucket(bucket, request, layer, request.data).map(_ => Array.empty[Byte]).futureBox

      // We will never wait here for ever, since all parts of the feature are upper bounded by Await.result on their own
      Await.result(f, Duration.Inf)
    } catch {
      case e: Exception =>
        logger.error(s"Saving block failed for. Error: $e")
        e.printStackTrace()
        Failure("dataStore.save.synchronousFailed", Full(e), Empty)
    }
  }

  def saveBucket(
    bucket: BucketPosition,
    request: DataWriteRequest,
    layer: DataLayer,
    modifiedData: Array[Byte]): Fox[Boolean] = {

    def saveToSections(sections: List[DataLayerSection]): Fox[Boolean] = sections match {
      case section :: tail =>
        val saveBucket = BucketWriteInstruction(
          request.dataSource, layer, section, bucket, modifiedData)
        saveToLayer(saveBucket).futureBox.flatMap {
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

  def saveToLayer(saveBucket: BucketWriteInstruction): Fox[Boolean] = {
    if (saveBucket.dataLayerSection.doesContainBucket(saveBucket.position)) {
      saveBucket.dataLayer.bucketHandler(cache).save(saveBucket, dataSaveTimeout)
    } else {
      Fox.empty
    }
  }
}

trait DataReadRequester {
  this: DataRequester =>

  def requestCuboidData[T](request: DataReadRequest): Fox[Array[Byte]] = {

    val bucketQueue = request.cuboid.allBucketsInCuboid(request.dataSource.lengthOfLoadedBuckets)

    loadAllBucketsOfRequest(bucketQueue, request).map { rs =>
      // after we have loaded all buckets that 'touch' our cuboid we want to retrieve, we need to cut the data from
      // the loaded buckets
      cutOutCuboid(rs, request)
    }
  }

  /**
    * Given a list of loaded buckets, cutout the data of the cuboid
    */
  private def cutOutCuboid(rs: List[(BucketPosition, Array[Byte])], request: DataReadRequest) = {
    val bytesPerElement = request.dataLayer.bytesPerElement
    val cuboid = request.cuboid
    val result = new Array[Byte](cuboid.volume * bytesPerElement)
    val bucketLength = request.dataSource.lengthOfLoadedBuckets

    rs.reverse.foreach {
      case (bucket, data) =>
        val x = math.max(cuboid.topLeft.x, bucket.topLeft.x)
        var y = math.max(cuboid.topLeft.y, bucket.topLeft.y)
        var z = math.max(cuboid.topLeft.z, bucket.topLeft.z)

        val xMax = math.min(bucket.topLeft.x + bucketLength, cuboid.bottomRight.x)
        val yMax = math.min(bucket.topLeft.y + bucketLength, cuboid.bottomRight.y)
        val zMax = math.min(bucket.topLeft.z + bucketLength, cuboid.bottomRight.z)

        while (z < zMax) {
          y = math.max(cuboid.topLeft.y, bucket.topLeft.y)
          while (y < yMax) {
            val dataOffset =
              (x % bucketLength +
                y % bucketLength * bucketLength +
                z % bucketLength * bucketLength * bucketLength) * bytesPerElement
            val rx = x - cuboid.topLeft.x
            val ry = y - cuboid.topLeft.y
            val rz = z - cuboid.topLeft.z

            val resultOffset = (rx + ry * cuboid.width + rz * cuboid.width * cuboid.height) * bytesPerElement
            System.arraycopy(data, dataOffset, result, resultOffset, (xMax - x) * bytesPerElement)
            y += 1
          }
          z += 1
        }
    }
    result
  }

  /**
    * Loads all the buckets (where each position is the top-left of the bucket) from the passed layer.
    */
  private def loadAllBucketsOfRequest(buckets: Seq[BucketPosition], request: DataReadRequest) = {
    Fox.serialCombined(buckets.toList) { bucket =>
      handleBucketReadRequest(bucket, request).map(r => bucket -> r)
    }
  }
}
